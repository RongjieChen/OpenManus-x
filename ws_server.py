import uvicorn
import json
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.agent.manus import Manus
from app.logger import logger
from app.schema import AgentState

app = FastAPI(
    title="OpenManus-x FastAPI",
    description="OpenManus-x FastAPI服务",
    version="1.0.0",
)

class RequestMsg(BaseModel):
    content: str

class ResponseMsg(BaseModel):
    role: str
    content: str

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.agents: Dict[str, Manus] = {}

    def get_agent(self, client_id: str) -> Optional[Manus]:
        if client_id in self.agents:
            return self.agents[client_id]
        logger.warning(f"Agent {client_id} not found")
        try:
            agent = Manus()
            self.agents[client_id] = agent
            return agent
        except Exception as e:
            logger.error(f"Error creating agent {client_id}: {e}")
            return None

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        logger.info(f"Client connected: {client_id}")

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        if client_id in self.agents:
            try:
                agent = self.agents[client_id]
                if hasattr(agent, "cleanup") and callable(agent.cleanup):
                    agent.cleanup()
            except Exception as e:
                logger.error(f"Error during cleanup for agent {client_id}: {e}")
            del self.agents[client_id]
        logger.info(f"Client disconnected: {client_id}")

    async def send_message(self, message: str, client_id: str):
        if client_id in self.active_connections:
            websocket = self.active_connections[client_id]
            await websocket.send_text(message)
        else:
            logger.warning(f"Client {client_id} not connected")

manager = WebSocketManager()

@app.post("/api/chat", response_model=ResponseMsg)
async def chat(request_msg: RequestMsg):
    agent = Manus()
    try:
        result = await agent.run(request_msg.content)
        return ResponseMsg(role="assistant", content=result)
    except Exception as e:
        logger.error(f"Error during chat: {e}")
        return JSONResponse(
            status_code=500,
            content={"message": f"Error during chat: {e}"},
        )

async def run_agent_with_reasoning(agent: Manus, content: str) -> str:
    original_step_method = agent.step
    reasoning_steps = []

    async def step_with_capture() -> str:
        step_result = await original_step_method()
        reasoning_steps.append(f"步骤 {agent.current_step}: {step_result}")
        return step_result

    agent.step = step_with_capture

    try:
        result = await agent.run(content)

        reasoning = "\n".join(reasoning_steps)
        final_result = f"[推理过程:开始]\n{reasoning}\n[推理过程:结束]\n\n{result}"
        return final_result
    finally:
        agent.step = original_step_method

async def run_agent_with_reasoning_stream(agent: Manus, content: str, websocket: WebSocket) -> str:
    original_step_method = agent.step

    await websocket.send_json({
        "type": "reasoning_start",
        "content": "推理开始..."
    })

    async def step_with_stream() -> str:
        step_result = await original_step_method()
        step_message = f"步骤 {agent.current_step}: {step_result}"
        await websocket.send_json({
            "type": "reasoning_step",
            "content": step_message
        })
        return step_result

    agent.step = step_with_stream

    try:
        result = await agent.run(content)

        await websocket.send_json({
            "type": "reasoning_end",
            "content": "推理完成"
        })

        return result
    finally:
        agent.step = original_step_method

@app.websocket("/ws/chat/{client_id}")
async def websocket(websocket: WebSocket, client_id: str):
    await websocket.accept()
    logger.info(f"WebSocket已连接: {client_id}")

    agent = manager.get_agent(client_id)
    if agent is None:
        logger.error(f"无法创建代理实例: {client_id}")
        await websocket.send_text("无法创建代理实例")
        await websocket.close(code=500)
        return

    is_disconnected = False

    try:
        while True:
            if is_disconnected:
                logger.warning(f"连接已断开: {client_id}")
                break

            try:
                data = await websocket.receive_text()
            except WebSocketDisconnect:
                logger.error(f"WebSocketDisconnect error: {client_id}")
                is_disconnected = True
                break
            except Exception as e:
                logger.error(f"接收消息错误: {str(e)}")
                is_disconnected = True
                break

            try:
                message_data = json.loads(data)
                message_type = message_data.get('type', 'message')
                content = message_data.get('content', '')

                logger.info(f"收到消息 [{message_type}]: {content[:30]}...")

                if message_type == 'cancel':
                    if hasattr(agent, 'state') and agent.state == AgentState.RUNNING:
                        agent.state = AgentState.IDLE
                        await websocket.send_text("操作已取消")
                    continue

                # 发送处理中提示
                await websocket.send_json({
                    "type": "processing",
                    "content": "处理中..."
                })

                # 执行代理并实时流式输出推理过程
                logger.info(f"执行代理: {content[:30]}...")
                result = await run_agent_with_reasoning_stream(agent, content, websocket)

                # 发送最终结果
                logger.info(f"发送最终结果: 长度 {len(result)} 字符")
                await websocket.send_json({
                    "type": "result",
                    "content": result
                })

            except json.JSONDecodeError:
                logger.error(f"JSON解析错误: {data}")
                await websocket.send_json({
                    "type": "error",
                    "content": "消息格式错误"
                })
            except Exception as e:
                logger.error(f"处理消息错误: {str(e)}")
                await websocket.send_json({
                    "type": "error",
                    "content": f"处理消息时出错: {str(e)}"
                })
    except WebSocketDisconnect:
        logger.info(f"WebSocket连接已断开: {client_id}")
    except Exception as e:
        logger.error(f"WebSocket错误: {str(e)}")
    finally:
        logger.info(f"WebSocket连接关闭: {client_id}")
        manager.disconnect(client_id)

@app.get("/")
async def read_root():
    return {"status": "启动成功"}

if __name__ == '__main__':
    uvicorn.run(app, host="0.0.0.0", port=8000)

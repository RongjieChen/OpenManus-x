import uvicorn
import json
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.agent.manus import Manus
from app.logger import logger
from app.schema import AgentState

app = FastAPI(
    title="OpenManus-x FastAPI",
    description="OpenManus-x FastAPI",
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

async def run_agent_with_reasoning_stream(agent: Manus, content: str, websocket: WebSocket) -> str:
    original_step_method = agent.step

    await websocket.send_json({
        "type": "reasoning_start",
        "content": "Reasoning started..."
    })

    async def step_with_stream() -> str:
        step_result = await original_step_method()
        step_message = f"step {agent.current_step}: {step_result}"
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
            "content": "Reasoning completed"
        })

        return result
    finally:
        agent.step = original_step_method

@app.websocket("/websocket/{client_id}")
async def websocket(websocket: WebSocket, client_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {client_id}")

    agent = manager.get_agent(client_id)
    if agent is None:
        logger.error(f"Failed to create agent instance: {client_id}")
        await websocket.send_text("Failed to create agent instance")
        await websocket.close(code=500)
        return

    is_disconnected = False

    try:
        while True:
            if is_disconnected:
                logger.warning(f"Connection disconnected: {client_id}")
                break

            try:
                data = await websocket.receive_text()
            except WebSocketDisconnect:
                logger.error(f"WebSocketDisconnect error: {client_id}")
                is_disconnected = True
                break
            except Exception as e:
                logger.error(f"Error receiving message: {str(e)}")
                is_disconnected = True
                break

            try:
                message_data = json.loads(data)
                message_type = message_data.get('type', 'message')
                content = message_data.get('content', '')

                logger.info(f"receive message [{message_type}]: {content[:30]}...")

                if message_type == 'cancel':
                    if hasattr(agent, 'state') and agent.state == AgentState.RUNNING:
                        agent.state = AgentState.IDLE
                        await websocket.send_text("Operation cancelled")
                    continue

                await websocket.send_json({
                    "type": "processing",
                    "content": "Processing..."
                })

                logger.info(f"Executing agent: {content[:30]}...")
                result = await run_agent_with_reasoning_stream(agent, content, websocket)

                logger.info(f"Sending final result: length {len(result)} characters")
                await websocket.send_json({
                    "type": "result",
                    "content": result
                })

            except json.JSONDecodeError:
                logger.error(f"JSON parse error: {data}")
                await websocket.send_json({
                    "type": "error",
                    "content": "Invalid message format"
                })
            except Exception as e:
                await websocket.send_json({
                    "type": "error",
                    "content": f"Error processing message: {str(e)}"
                })
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {client_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        logger.info(f"WebSocket connection closed: {client_id}")
        manager.disconnect(client_id)

@app.get("/")
async def read_root():
    return {"status": "Started successfully"}

if __name__ == '__main__':
    uvicorn.run(app, host="0.0.0.0", port=8000)

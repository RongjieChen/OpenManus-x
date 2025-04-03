import { useState, useEffect, useRef } from 'react';
import { Layout, Button, Input, message } from 'antd';
import ReactMarkdown from 'react-markdown';
import { PlusOutlined, SettingOutlined, InfoCircleOutlined, CodeOutlined, RobotOutlined, RiseOutlined, DatabaseOutlined } from '@ant-design/icons';
import './App.css';

const { Header, Sider, Content } = Layout;
const { TextArea } = Input;

// 生成唯一ID
const generateId = () => {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

function App() {
    const [messages, setMessages] = useState<Array<{ type: 'user' | 'assistant', content: string }>>([]);
    const [inputValue, setInputValue] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [chatHistory, setChatHistory] = useState<Array<{ id: string, messages: Array<{ type: 'user' | 'assistant', content: string }> }>>([]);
    const [currentChatId, setCurrentChatId] = useState<string>(generateId());

    // 使用useRef保存clientId，确保它在组件生命周期内保持不变
    const clientIdRef = useRef(generateId());
    const socketInitializedRef = useRef(false);

    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (socketInitializedRef.current) return;

        const connectWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//localhost:8000/ws/chat/${clientIdRef.current}`;

            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                setIsConnected(true);
                socketInitializedRef.current = true;
                socketRef.current = ws;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    const { type, content } = data;

                    switch (type) {
                        case 'processing':
                            setIsProcessing(true);
                            break;
                        case 'result':
                            setIsProcessing(false);
                            setMessages(prev => [...prev, { type: 'assistant', content }]);
                            break;
                        case 'error':
                            setIsProcessing(false);
                            message.error(content);
                            break;
                        default:
                            if (content === '处理中...') {
                                setIsProcessing(true);
                            } else {
                                setIsProcessing(false);
                                setMessages(prev => [...prev, { type: 'assistant', content }]);
                            }
                    }
                } catch (e) {
                    const message = event.data;
                    if (message === '处理中...') {
                        setIsProcessing(true);
                    } else {
                        setIsProcessing(false);
                        setMessages(prev => [...prev, { type: 'assistant', content: message }]);
                    }
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                message.error('WebSocket连接已断开');
                socketInitializedRef.current = false;
                socketRef.current = null;
            };
        };

        connectWebSocket();

        return () => {
            if (socketRef.current) {
                socketRef.current.close();
                socketRef.current = null;
            }
            socketInitializedRef.current = true;
        };
    }, []);

    // 从本地存储加载聊天历史
    const loadChatHistory = () => {
        const savedHistory = localStorage.getItem('chatHistory');
        if (savedHistory) {
            try {
                const history = JSON.parse(savedHistory);
                setChatHistory(history);
                // 如果有历史记录，加载最后一个对话的消息
                if (history.length > 0) {
                    const lastChat = history[history.length - 1];
                    setCurrentChatId(lastChat.id);
                    setMessages(lastChat.messages);
                }
            } catch (e) {
                console.error('加载聊天历史失败:', e);
            }
        }
    };

    // 保存聊天消息到历史记录
    const saveChatMessage = (type: 'user' | 'assistant', content: string) => {
        const newMessage = { type, content };
        setMessages(prev => {
            const newMessages = [...prev, newMessage];
            const updatedHistory = chatHistory.map(chat =>
                chat.id === currentChatId
                    ? { ...chat, messages: newMessages }
                    : chat
            );
            if (!chatHistory.find(chat => chat.id === currentChatId)) {
                updatedHistory.push({ id: currentChatId, messages: newMessages });
            }
            setChatHistory(updatedHistory);
            localStorage.setItem('chatHistory', JSON.stringify(updatedHistory));
            return newMessages;
        });
    };

    // 清除所有聊天历史
    const clearAllChatHistory = () => {
        setChatHistory([]);
        setMessages([]);
        setCurrentChatId(generateId());
        localStorage.removeItem('chatHistory');
    };

    // 开始新对话
    const startNewChat = () => {
        const newChatId = generateId();
        setCurrentChatId(newChatId);
        setMessages([]);
    };

    // 加载指定对话
    const loadChat = (chatId: string) => {
        const chat = chatHistory.find(c => c.id === chatId);
        if (chat) {
            setCurrentChatId(chatId);
            setMessages(chat.messages);
        }
    };

    // 在组件挂载时加载历史记录
    useEffect(() => {
        loadChatHistory();
    }, []);

    const setPrompt = (prompt: string) => {
        setInputValue(prompt);
    };

    const handleSend = () => {
        if (!inputValue.trim() || !socketRef.current || !socketInitializedRef.current || isProcessing) return;

        saveChatMessage('user', inputValue);
        try {
            socketRef.current.send(JSON.stringify({
                type: 'message',
                content: inputValue
            }));
            setInputValue('');
            setIsProcessing(true);
        } catch (error) {
            console.error('发送消息失败:', error);
            message.error('发送消息失败，请检查网络连接');
        }
    };

    return (
        <Layout style={{ height: '100vh' }}>
            <Sider width={260} style={{ backgroundColor: 'var(--sidebar-color)', borderRight: '1px solid var(--border-color)' }}>
                <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
                    <h1 style={{ fontSize: '20px', marginBottom: '16px', color: 'var(--primary-color)' }}>OpenManus</h1>
                    <Button type="primary" icon={<PlusOutlined />} onClick={startNewChat} block style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        新对话
                    </Button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                    {chatHistory.map(chat => {
                        const firstMessage = chat.messages[0];
                        return (
                            <div
                                key={chat.id}
                                onClick={() => loadChat(chat.id)}
                                style={{
                                    padding: '12px',
                                    borderRadius: '8px',
                                    backgroundColor: currentChatId === chat.id ? 'var(--primary-color)' : 'transparent',
                                    color: currentChatId === chat.id ? 'white' : 'var(--text-color)',
                                    cursor: 'pointer',
                                    marginBottom: '8px',
                                    transition: 'all 0.3s'
                                }}
                            >
                                {firstMessage ? firstMessage.content.substring(0, 30) + (firstMessage.content.length > 30 ? '...' : '') : '新对话'}
                            </div>
                        );
                    })}
                </div>
                <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)' }}>
                    <Button icon={<SettingOutlined />} onClick={() => clearAllChatHistory()} block style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                        清除历史记录
                    </Button>
                </div>
            </Sider>
            <Layout>
                <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {isConnected && (
                        <div style={{ padding: '8px 16px', backgroundColor: 'var(--success-color)', color: 'white', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                            <InfoCircleOutlined />
                            <span>WebSocket连接已建立</span>
                        </div>
                    )}
                    <Content style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                            {messages.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                                    <h1 style={{ fontSize: '32px', marginBottom: '16px' }}>OpenManus Web</h1>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>一个多功能智能代理，可以帮助您解决各种任务</p>
                                    <h3 style={{ marginBottom: '16px' }}>您可以尝试：</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                                        <div onClick={() => setPrompt('帮我写一个Python爬虫，抓取豆瓣Top250电影')} style={{ padding: '24px', backgroundColor: 'white', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' }}>
                                            <CodeOutlined style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--primary-color)' }} />
                                            <p>帮我写一个Python爬虫，抓取豆瓣Top250电影</p>
                                        </div>
                                        <div onClick={() => setPrompt('用Python编写一个简单的贪吃蛇游戏')} style={{ padding: '24px', backgroundColor: 'white', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' }}>
                                            <RobotOutlined style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--primary-color)' }} />
                                            <p>用Python编写一个简单的贪吃蛇游戏</p>
                                        </div>
                                        <div onClick={() => setPrompt('帮我分析一下最近人工智能发展的趋势')} style={{ padding: '24px', backgroundColor: 'white', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' }}>
                                            <RiseOutlined style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--primary-color)' }} />
                                            <p>帮我分析一下最近人工智能发展的趋势</p>
                                        </div>
                                        <div onClick={() => setPrompt('如何使用Python处理大规模数据？')} style={{ padding: '24px', backgroundColor: 'white', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' }}>
                                            <DatabaseOutlined style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--primary-color)' }} />
                                            <p>如何使用Python处理大规模数据？</p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {messages.map((msg, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                marginBottom: '16px',
                                                textAlign: msg.type === 'user' ? 'right' : 'left'
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: 'inline-block',
                                                    padding: '12px 16px',
                                                    borderRadius: '12px',
                                                    backgroundColor: msg.type === 'user' ? 'var(--primary-color)' : 'white',
                                                    color: msg.type === 'user' ? 'white' : 'var(--text-color)',
                                                    maxWidth: '80%',
                                                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                                                }}
                                            >
                                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                                            </div>
                                        </div>
                                    ))}
                                    {isProcessing && (
                                        <div style={{ textAlign: 'left', marginBottom: '16px' }}>
                                            <div
                                                style={{
                                                    display: 'inline-block',
                                                    padding: '12px 16px',
                                                    borderRadius: '12px',
                                                    backgroundColor: 'white',
                                                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                                                }}
                                            >
                                                处理中...
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </Content>
                    <div style={{ borderTop: '1px solid var(--border-color)', padding: '24px' }}>
                        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <TextArea
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder="输入消息..."
                                    autoSize={{ minRows: 1, maxRows: 6 }}
                                    onPressEnter={(e) => {
                                        if (!e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    style={{ borderRadius: '8px' }}
                                />
                                <Button
                                    type="primary"
                                    onClick={handleSend}
                                    disabled={!isConnected || isProcessing || !inputValue.trim()}
                                    style={{ borderRadius: '8px' }}
                                >
                                    发送
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </Layout>
        </Layout>
    )
}

export default App

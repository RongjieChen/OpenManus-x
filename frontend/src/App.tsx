import { useState, useEffect, useRef } from 'react';
import { Layout, Button, Input, message } from 'antd';
import ReactMarkdown from 'react-markdown';
import { PlusOutlined, SettingOutlined, InfoCircleOutlined, CodeOutlined, RobotOutlined, RiseOutlined, DatabaseOutlined } from '@ant-design/icons';
import './App.css';

const { Sider, Content } = Layout;
const { TextArea } = Input;

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

    const clientIdRef = useRef(generateId());
    const socketInitializedRef = useRef(false);

    const socketRef = useRef<WebSocket | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (socketInitializedRef.current) return;

        const connectWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//localhost:8000/websocket/${clientIdRef.current}`;

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
                            saveChatMessage('assistant', content)
                            break;
                        case 'error':
                            setIsProcessing(false);
                            message.error(content);
                            break;
                        default:
                            if (content === 'processing...') {
                                setIsProcessing(true);
                            } else {
                                setIsProcessing(false);
                                setMessages(prev => [...prev, { type: 'assistant', content }]);
                            }
                    }
                } catch (e) {
                    const message = event.data;
                    if (message === 'processing...') {
                        setIsProcessing(true);
                    } else {
                        setIsProcessing(false);
                        setMessages(prev => [...prev, { type: 'assistant', content: message }]);
                    }
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                message.error('WebSocket Disconnected');
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

    const loadChatHistory = () => {
        const savedHistory = localStorage.getItem('chatHistory');
        if (savedHistory) {
            try {
                const history = JSON.parse(savedHistory);
                setChatHistory(history);
                if (history.length > 0) {
                    const lastChat = history[history.length - 1];
                    setCurrentChatId(lastChat.id);
                    setMessages(lastChat.messages);
                }
            } catch (e) {
                console.error('Failed to load chat history:', e);
            }
        }
    };

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

    const clearAllChatHistory = () => {
        setChatHistory([]);
        setMessages([]);
        setCurrentChatId(generateId());
        localStorage.removeItem('chatHistory');
    };

    const startNewChat = () => {
        const newChatId = generateId();
        setCurrentChatId(newChatId);
        setMessages([]);
    };

    const loadChat = (chatId: string) => {
        const chat = chatHistory.find(c => c.id === chatId);
        if (chat) {
            setCurrentChatId(chatId);
            setMessages(chat.messages);
        }
    };

    useEffect(() => {
        loadChatHistory();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
            console.error('Send Message Error:', error);
            message.error('Send Message Error，Please check your network.');
        }
    };

    return (
        <Layout style={{ height: '100vh' }}>
            <Sider width={260} style={{ backgroundColor: 'var(--sidebar-color)', borderRight: '1px solid var(--border-color)' }}>
                <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
                    <h1 style={{ fontSize: '20px', marginBottom: '16px', textAlign: 'center' }}>OpenManus</h1>
                    <Button type="primary" icon={<PlusOutlined />} onClick={startNewChat} block style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        New Chat
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
                                    transition: 'all 0.3s',
                                    textAlign: 'left'
                                }}
                            >
                                {firstMessage ? firstMessage.content.substring(0, 30) + (firstMessage.content.length > 30 ? '...' : '') : 'New Chat'}
                            </div>
                        );
                    })}
                </div>
                <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)' }}>
                    <Button icon={<SettingOutlined />} onClick={() => clearAllChatHistory()} block style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                        Clear History
                    </Button>
                </div>
            </Sider>
            <Layout>
                <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {isConnected && (
                        <div style={{ padding: '8px 16px', backgroundColor: 'var(--success-color)', color: 'white', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                            <InfoCircleOutlined />
                            <span>WebSocket Connected</span>
                        </div>
                    )}
                    <Content style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                            {messages.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                                    <h1 style={{ fontSize: '32px', marginBottom: '16px' }}>OpenManus</h1>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>Manus is incredible, but OpenManus can achieve any idea without an Invite Code 🛫!</p>
                                    <h3 style={{ marginBottom: '16px' }}>You Can Try：</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                                        <div onClick={() => setPrompt('I need a 7-day Japan itinerary for April 15-23 from Seattle, with a $2500-5000 budget for my fiancée and me. We love historical sites, hidden gems, and Japanese culture (kendo, tea ceremonies, Zen meditation). We want to see Nara\'s deer and explore cities on foot.I plan to propose during this trip and need a special location recommendation.Please provide a detailed itinerary and a simple HTML travel handbook with maps, attraction descriptions, essential Japanese phrases, and travel tips we can reference throughout our journey.')} style={{ padding: '24px', backgroundColor: 'white', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' }}>
                                            <CodeOutlined style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--primary-color)' }} />
                                            <p>7-Day Japan Itinerary with Proposal Ideas</p>
                                        </div>
                                        <div onClick={() => setPrompt('What vertical search AI solutions exist in the fashion industry? In which specific scenarios are they deployed? What are their pricing models? Which parts of the value chain do they serve? How do these products differentiate from one another?')} style={{ padding: '24px', backgroundColor: 'white', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' }}>
                                            <RobotOutlined style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--primary-color)' }} />
                                            <p>Vertical Search AI Solutions in Fashion Industry</p>
                                        </div>
                                        <div onClick={() => setPrompt('I am a middle school physics teacher preparing to teach the law of conservation of momentum. Could you create a series of clear and accurate demonstration animations and organize them into a simple presentation html?')} style={{ padding: '24px', backgroundColor: 'white', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' }}>
                                            <RiseOutlined style={{ fontSize: '24px', marginBottom: '16px', color: 'var(--primary-color)' }} />
                                            <p>Conservation of Momentum Teaching Animations and Presentation</p>
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
                                                processing...
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
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
                                    placeholder="Enter Message..."
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
                                    Send
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </Layout >
        </Layout >
    )
}

export default App

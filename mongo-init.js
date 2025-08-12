// MongoDB 初始化脚本
db = db.getSiblingDB('ai-chat-bot');

// 创建集合
db.createCollection('conversations');

// 创建索引
db.conversations.createIndex({ "id": 1 }, { unique: true });
db.conversations.createIndex({ "updatedAt": -1 });
db.conversations.createIndex({ "title": "text", "messages.content": "text" });

print('Database initialized successfully');

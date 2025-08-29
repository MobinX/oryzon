export interface IMessagingClient {
    sendTextMessage(recipientId: string, text: string): Promise<void>;
    sendImageMessage(recipientId: string, imageUrl: string): Promise<void>;
    markSeen(recipientId: string): Promise<void>;
    toggleTyping(recipientId: string, isTyping: boolean): Promise<void>;
}
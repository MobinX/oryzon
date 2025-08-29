import { FacebookMessagingAPIClient } from 'fb-messenger-bot-api';
import { IMessagingClient } from '../IMessagingClient';

export class FacebookClient implements IMessagingClient {
    private client: FacebookMessagingAPIClient;

    constructor(accessToken: string) {
        this.client = new FacebookMessagingAPIClient(accessToken);
    }

    async sendTextMessage(recipientId: string, text: string): Promise<void> {
        await this.client.sendTextMessage(recipientId, text);
    }

    async sendImageMessage(recipientId: string, imageUrl: string): Promise<void> {
        await this.client.sendImageMessage(recipientId, imageUrl);
    }

    async markSeen(recipientId: string): Promise<void> {
        await this.client.markSeen(recipientId);
    }

    async toggleTyping(recipientId: string, isTyping: boolean): Promise<void> {
        await this.client.toggleTyping(recipientId, isTyping);
    }
}
import { channelsService } from '@/backend/services/channels/channels.service';
import { customersService } from '@/backend/services/customers/customers.service';
import { chatsService } from '@/backend/services/chats/chats.service';
import { messagesService } from '@/backend/services/messages/messages.service';
import { executeAgent } from '@/backend/services/ai/manager';
import { Customer } from '@/backend/services/customers/customers.types';
import { ConnectedChannelWithIncludes } from '@/backend/services/channels/channels.types';
import { Chat } from '@/backend/services/chats/chats.types';
import { messages, platformTypeEnum } from '@/db/schema';
import { IMessagingClient } from './IMessagingClient';
import { FacebookClient } from './clients/FacebookClient';

export interface GenericMessage {
    sender: { id: string };
    recipient: { id: string };
    message?: {
        mid?: string;
        text?: string;
        attachments?: Array<{ type: string; payload?: unknown }>;
        is_echo?: boolean;
    };
}

export class MessageHandler {
    private client: IMessagingClient | null = null;
    private channel: ConnectedChannelWithIncludes | null = null;
    private customer: Customer | null = null;
    private chat: Chat | null = null;
    private log: (message: string, ...args: unknown[]) => void;
    private platform: (typeof platformTypeEnum.enumValues)[number];

    constructor(platform: (typeof platformTypeEnum.enumValues)[number], log: (message: string, ...args: unknown[]) => void = console.log) {
        this.platform = platform;
        this.log = log;
    }

    public async handleIncomingMessage<T extends GenericMessage>(message: T): Promise<void> {
        if (message.sender.id === message.recipient.id || !message.message || message.message.is_echo) {
            return;
        }

        this.log(`Processing message for recipient: ${message.recipient.id} from sender: ${message.sender.id}`);
        await this.initialize(message.recipient.id, message.sender.id);

        if (!this.channel || !this.customer || !this.chat) {
            this.log('Initialization failed, aborting message handling.');
            return;
        }

        await chatsService.handleNewMessage(
            this.formatMessageContent(message),
            this.chat.chatId,
        );

        if (this.chat.status !== 'PROCESSING') {
            await chatsService.updateChatStatus(this.chat.chatId, 'PROCESSING');
        }

        this.log(`Triggering queue processing for chat: ${this.chat.chatId}`);
        try {
            // Use fetch to trigger the queue processing asynchronously in a new serverless invocation
            fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/facebook/process-queue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: this.chat.chatId }),
                signal: AbortSignal.timeout(20000) // 20 second timeout
        });

        //wait for 2s then return response
        await new Promise(resolve => setTimeout(resolve, 2000));
            
            
        } catch (error) {
            this.log(`Failed to trigger queue processing for chat ${this.chat.chatId}:`, error);
            // Optionally, reset status to allow for another attempt on the next message
            await chatsService.updateChatStatus(this.chat.chatId, 'OPEN');
        }
    }

    public async _processQueue(chatId: string): Promise<void> {
        this.log(`Processing queue for chat: ${chatId}`);
        const pendingMessages = await messagesService.getPendingMessages(chatId);

        if (pendingMessages.length === 0) {
            this.log(`No pending messages for chat: ${chatId}. Closing queue.`);
            await chatsService.updateChatStatus(chatId, 'OPEN');
            return;
        }

        await this.initializeFromChatId(chatId);

        if (!this.channel || !this.customer || !this.chat || !this.client) {
            this.log('Initialization failed, aborting queue processing.');
            return;
        }

        await messagesService.updateMessageStatus(
            pendingMessages.map(m => m.message_id),
            'PROCESSING'
        );

        try {
            await this.executeAI(pendingMessages, this.customer.platformCustomerId);
            await messagesService.updateMessageStatus(
                pendingMessages.map(m => m.message_id),
                'PROCESSED'
            );
        } catch (error) {
            this.log(`Error processing messages for chat ${chatId}:`, error);
            await messagesService.updateMessageStatus(
                pendingMessages.map(m => m.message_id),
                'FAILED'
            );
            await this.client.sendTextMessage(this.customer.platformCustomerId, "Sorry, something went wrong while processing your message. Please try again later.");
        } finally {
            // Check for any new messages that arrived during processing
        	
        	await new Promise(resolve => setTimeout(resolve, 2000));
            const newPendingMessages = await messagesService.getPendingMessages(chatId);
            this.log(JSON.stringify(newPendingMessages))
            if (newPendingMessages.length > 0) {
                this.log(`New messages arrived for chat: ${chatId}. Re-running queue.`);
                await this._processQueue(chatId);
            } else {
                this.log(`Queue for chat: ${chatId} is empty. Closing.`);
                await chatsService.updateChatStatus(chatId, 'OPEN');
            }
        }
    }

    private async initialize(recipientPageId: string, senderPlatformId: string): Promise<void> {
        const { data } = await channelsService.getAllChannels({
            filter: { platformSpecificId: recipientPageId },
            include: {
                business: true,
                customers: { limit: 1, platformCustomerId: senderPlatformId },
                chats: { limit: 1, platformCustomerId: senderPlatformId }
            },
            limit: 1,
        });
        this.channel = data[0];
        if (this.channel && this.channel.accessToken) {
            this.log(`Found channel: ${this.channel.channelId}`);
            this.client = this.getClient(this.channel.accessToken);
            this.customer = this.channel.customers?.[0] || null;
            this.chat = this.channel.chats?.[0] || null;
        } else {
            this.log(`Channel not found or access token is missing for recipient: ${recipientPageId}`);
        }

        if (this.channel) {
            await this.findOrCreateCustomer(senderPlatformId);
            await this.findOrCreateChat(senderPlatformId);
        }
    }

    private async initializeFromChatId(chatId: string): Promise<void> {
        const chatWithIncludes = await chatsService.getChatById(chatId, { include: { connectedChannel: true, customer: true } });
        if (chatWithIncludes && chatWithIncludes.connectedChannel && chatWithIncludes.customer) {
            this.chat = chatWithIncludes;
            this.channel = chatWithIncludes.connectedChannel;
            this.customer = chatWithIncludes.customer;
            if (this.channel.accessToken) {
                this.client = this.getClient(this.channel.accessToken);
            }
        }
    }

    private getClient(accessToken: string): IMessagingClient | null {
        switch (this.platform) {
            case 'FACEBOOK_PAGE':
                return new FacebookClient(accessToken);
            default:
                this.log(`Unsupported platform: ${this.platform}`);
                return null;
        }
    }

    private async findOrCreateCustomer(senderPlatformId: string): Promise<void> {
        if (this.customer) {
            this.log(`Found customer: ${this.customer.customerId}`);
        } else if (this.channel) {
            this.customer = await customersService.createCustomer({
                platformCustomerId: senderPlatformId,
                channelId: this.channel.channelId,
                fullName: `User ${senderPlatformId}`,
                businessId: this.channel.business!.businessId,
            });
            this.log(`Created new customer: ${this.customer.customerId}`);
        }
    }

    private async findOrCreateChat(senderPlatformId: string): Promise<void> {
        if (this.chat) {
            this.log(`Found chat: ${this.chat.chatId}`);
        } else if (this.channel) {
            this.chat = await chatsService.createChat({
                platformCustomerId: senderPlatformId,
                channelId: this.channel.channelId,
                businessId: this.channel.business!.businessId,
                providerUserId: this.channel.providerUserId,
                status: 'OPEN',
            });
            this.log(`Created new chat: ${this.chat.chatId}`);
        }
    }

    private formatMessageContent(message: GenericMessage): Omit<typeof messages.$inferInsert, 'messageId' | 'chatId' | 'timestamp'> {
        if (message.message?.text) {
            return {
                content: message.message.text,
                senderType: 'CUSTOMER',
                contentType: 'TEXT',
                platformMessageId: message.message.mid,
            };
        } else if (message.message?.attachments) {
            const attachment = message.message.attachments[0];
            if (attachment.type === 'image' && attachment.payload && typeof attachment.payload === 'object' && 'url' in attachment.payload) {
                const payload = attachment.payload as { url: string };
                return {
                    content: `A image with [IMAGE URL]: ${payload.url}`,
                    senderType: 'CUSTOMER',
                    contentType: 'IMAGE',
                };
            }
        }
        return {
            content: 'Unsupported message type',
            senderType: 'CUSTOMER',
            contentType: 'TEXT',
        };
    }

    private async executeAI(lastMsgs: (typeof messages.$inferSelect)[], messageSenderPsid: string): Promise<void> {
        const customerInfo = `
            Name: ${this.customer!.fullName}
            Contact: ${this.customer!.contact ? this.customer!.contact : "No contact available. If make any order ask contact number."}
            Address: ${this.customer!.address ? this.customer!.address : "No address available. If make any order ask address."}
        `;

        const replyUserFn = async (msg: unknown) => {
            const content = typeof msg === 'string' ? msg : JSON.stringify(msg);
            try { await this.client!.sendTextMessage(messageSenderPsid, content); } catch (e) { this.log("Error sending message to user:", e); }
            try {await this.client!.toggleTyping(messageSenderPsid, false);} catch (e) { this.log("Error toggling typing off:", e); }
           try { await chatsService.handleNewMessage(
                { content, senderType: 'BOT', contentType: 'TEXT', platformMessageId: undefined,status:"PROCESSED" },
                this.chat!.chatId,
            ); } catch (e) { this.log("Error logging bot message:", e); }
        };

        const replyUserWithProductImageAndInfoFn = async (productImageURL: string, productInfo: string) => {
            await this.client!.sendImageMessage(messageSenderPsid, productImageURL);
            await this.client!.sendTextMessage(messageSenderPsid, productInfo);
            await this.client!.toggleTyping(messageSenderPsid, false);
            await chatsService.handleNewMessage(
                { content: productInfo, senderType: 'BOT', contentType: 'TEXT', platformMessageId: undefined, status:"PROCESSED" },
                this.chat!.chatId,
            );
        };

        await executeAgent(
            lastMsgs,
            this.customer!.customerId,
            this.channel!.channelId,
            this.channel!.business?.description || null,
            this.channel!.business!.businessId,
            this.customer!.address || "",
            customerInfo,
            replyUserFn,
            replyUserWithProductImageAndInfoFn,
            this.log
        );
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { MessageHandler } from '@/backend/services/messaging/MessageHandler';

export async function POST(request: NextRequest): Promise<Response> {
    let chatId: string | undefined;
    try {
        const body = await request.json();
        chatId = body.chatId;

        if (!chatId) {
            return new Response('Missing chatId', { status: 400 });
        }

        const messageHandler = new MessageHandler('FACEBOOK_PAGE', console.log);
        await messageHandler._processQueue(chatId);

        return new Response('Queue processing complete', { status: 200 });
    } catch (error) {
        console.error(`Error processing queue for chat ${chatId}:`, error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
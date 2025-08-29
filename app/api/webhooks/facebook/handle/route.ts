import { NextRequest, NextResponse } from 'next/server';
import { FacebookMessageParser, FacebookMessagePayloadMessagingEntry as FacebookMessageObject } from 'fb-messenger-bot-api';
import { MessageHandler } from '@/backend/services/messaging/MessageHandler';

export async function GET(request: NextRequest): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
    } else {
        return new Response('Forbidden', { status: 403 });
    }
}

export async function POST(request: NextRequest): Promise<Response> {
    try {
        const body = await request.json();
        console.log('Received webhook body:', JSON.stringify(body, null, 2));
        const messagesFB: FacebookMessageObject[] = FacebookMessageParser.parsePayload(body);
        const messageHandler = new MessageHandler(console.log);

        for (const message of messagesFB) {
            //we have to await here!!
            await messageHandler.handle(message);
        }

        return new Response('EVENT_RECEIVED', { status: 200 });

    } catch (error) {
        console.error('Error handling message:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
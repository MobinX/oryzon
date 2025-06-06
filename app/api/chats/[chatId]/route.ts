import { chatsService } from '@/backend/services/chats/chats.service';
import { ChatIncludeOptions, UpdateChatData } from '@/backend/services/chats/chats.types';
import { parseIncludeQuery } from '@/app/api/utils'; // Corrected import path
import { chatStatusEnum } from '@/db/schema';

// Updated valid includes for a chat
const VALID_CHAT_INCLUDES: (keyof ChatIncludeOptions)[] = [
  'business',
  'userViaProviderId',
  'customer',
  'connectedChannel',
  'messages',
];

type ChatStatus = typeof chatStatusEnum.enumValues[number];

function isChatStatus(value: string): value is ChatStatus {
  return chatStatusEnum.enumValues.includes(value as ChatStatus);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const params = await context.params;
  const { chatId } = params;

  if (!chatId) {
    return new Response(JSON.stringify({ message: 'Chat ID is required' }), { status: 400 });
  }

  try {
    const url = new URL(request.url);
    const includeQuery = url.searchParams.get('include');
    const includeOptions = parseIncludeQuery<ChatIncludeOptions, keyof ChatIncludeOptions>(
      includeQuery,
      VALID_CHAT_INCLUDES
    );

    const chat = await chatsService.getChatById(chatId, { include: includeOptions });

    if (!chat) {
      return new Response(JSON.stringify({ message: 'Chat not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(chat), { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 });
  }
}

export async function PUT(request: Request, props: { params: Promise<{ chatId: string }> }) {
  const params = await props.params;
  const { chatId } = params;

  if (!chatId) {
    return new Response(JSON.stringify({ message: 'Chat ID is required' }), { status: 400 });
  }

  try {
    const body = await request.json() as UpdateChatData;
    // TODO: Add validation for body (e.g. with Zod)
    const updatedChat = await chatsService.updateChat(chatId, body);

    if (!updatedChat) {
      return new Response(JSON.stringify({ message: 'Chat not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(updatedChat), { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ chatId: string }> }) {
  const params = await props.params;
  const { chatId } = params;

  if (!chatId) {
    return new Response(JSON.stringify({ message: 'Chat ID is required' }), { status: 400 });
  }

  try {
    const deleted = await chatsService.deleteChat(chatId);

    if (!deleted) {
      return new Response(JSON.stringify({ message: 'Chat not found' }), { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 });
  }
}

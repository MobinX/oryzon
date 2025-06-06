import { usersService } from '@/backend/services/users/users.service';
import { UserIncludeOptions, UpdateUserData } from '@/backend/services/users/users.types';
import { parseIncludeQuery } from '@/app/api/utils'; // Corrected import path

// Updated valid includes for a user
const VALID_USER_INCLUDES: (keyof UserIncludeOptions)[] = [
  'businesses',
  // 'connectedChannels', // These were placeholders or denormalized, focusing on 'businesses'
  // 'products',
  // 'orders',
];

export async function GET(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const { userId } = params;

  if (!userId) {
    return new Response(JSON.stringify({ message: 'User ID is required' }), { status: 400 });
  }

  try {
    const url = new URL(request.url);
    const includeQuery = url.searchParams.get('include');
    const includeOptions = parseIncludeQuery<UserIncludeOptions, keyof UserIncludeOptions>(
      includeQuery,
      VALID_USER_INCLUDES
    );

    const user = await usersService.getUserById(userId, { include: includeOptions });

    if (!user) {
      return new Response(JSON.stringify({ message: 'User not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(user), { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 });
  }
}

export async function PUT(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const { userId } = params;

  if (!userId) {
    return new Response(JSON.stringify({ message: 'User ID is required' }), { status: 400 });
  }

  try {
    const body = await request.json() as UpdateUserData;
    // TODO: Add validation for body (e.g. with Zod)
    const updatedUser = await usersService.updateUser(userId, body);

    if (!updatedUser) {
      return new Response(JSON.stringify({ message: 'User not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(updatedUser), { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const { userId } = params;

  if (!userId) {
    return new Response(JSON.stringify({ message: 'User ID is required' }), { status: 400 });
  }

  try {
    const deleted = await usersService.deleteUser(userId);

    if (!deleted) {
      return new Response(JSON.stringify({ message: 'User not found' }), { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ message: 'Internal server error' }), { status: 500 });
  }
}

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import ChatPage from '../components/ChatPage';

export default async function Chat() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/');
  }

  return <ChatPage />;
}
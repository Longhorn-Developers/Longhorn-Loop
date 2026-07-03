import { Stack } from 'expo-router';
import { CreateEventProvider } from '@/app/context/CreateEventContext';

export default function CreateEventLayout() {
  return (
    <CreateEventProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </CreateEventProvider>
  );
}

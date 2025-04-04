import { UserStoryForm } from '@/components/playground/user-story-form';

export default function Home() {
  return (
    <div className='container mx-auto py-10 px-4 min-h-screen'>
      <h1 className='text-3xl font-bold mb-8'>Generate Azure DevOps Tasks</h1>
      <UserStoryForm />
    </div>
  );
}

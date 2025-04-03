import { UserStoryForm } from '@/components/playground/user-story-form';
import { TasksDisplay } from '@/components/playground/tasks-display';

export default function Home() {
  return (
    <div className='container mx-auto py-10 px-4 min-h-screen'>
      <h1 className='text-3xl font-bold mb-8'>Create Azure DevOps User Story</h1>
      <div className='flex w-full space-x-4'>
        <UserStoryForm />
        <TasksDisplay />
      </div>
    </div>
  );
}

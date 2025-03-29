import { UserStoryForm } from '@/components/playground/user-story-form';
import { TasksDisplay } from '@/components/playground/tasks-display';

export default function Home() {
  return (
    <main className='container mx-auto py-10 px-4 min-h-screen'>
      <h1 className='text-3xl font-bold mb-8'>Create Azure DevOps User Story</h1>
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-150px)] min-h-[700px]'>
        <div className='h-[65%]'>
          <UserStoryForm />
        </div>
        <div className='h-[65%]'>
          <TasksDisplay />
        </div>
      </div>
    </main>
  );
}

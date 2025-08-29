import { UserStoryForm } from '@/components/playground/user-story-form';

export default function Home() {
  return (
    <div className='container mx-auto py-10 px-4 min-h-screen'>
      <div className='max-w-4xl xl:max-w-6xl mx-auto'>
        <h1 className='text-2xl font-bold mb-2'>Test Playground</h1>
        <p className='text-md text-muted-foreground mb-8'>
          Use this playground to experiment with different AI prompts and inference parameters to test how Task Genie
          generates tasks.
        </p>
      </div>
      <UserStoryForm />
    </div>
  );
}

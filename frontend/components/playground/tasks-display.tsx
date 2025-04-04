'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

type Task = {
  id: string;
  title: string;
  description: string;
  assignedTo?: string;
};

export function TasksDisplay({ isSubmitting, tasks }: { isSubmitting: boolean; tasks: Task[] }) {
  return (
    <Card className='w-full h-full flex flex-col overflow-hidden'>
      <CardHeader className='flex-shrink-0'>
        <CardTitle>Generated Tasks</CardTitle>
        <CardDescription>Tasks automatically generated from the user story</CardDescription>
      </CardHeader>
      <CardContent className='flex-grow flex flex-col overflow-hidden pb-4'>
        {isSubmitting ? (
          <div className='flex flex-col items-center justify-center h-full space-y-4'>
            <div className='h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin'></div>
            <p className='text-sm text-muted-foreground'>Generating Tasks...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full space-y-4'>
            <p className='text-sm text-muted-foreground'>No Tasks</p>
          </div>
        ) : (
          <>
            <div className='flex justify-between items-center mb-4 flex-shrink-0'>
              <div className='flex items-center space-x-2'>
                <Badge variant='outline'>{tasks.length} Tasks</Badge>
              </div>
            </div>

            <ScrollArea className='flex-grow overflow-auto pr-4'>
              <div className='space-y-4 pb-2'>
                {tasks.map((task, i) => (
                  <TaskCard key={i} task={task} />
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <Card className='border-l-4 border-l-primary'>
      <CardContent className='p-3'>
        <div className='flex items-start justify-between'>
          <div className='flex items-start space-x-3'>
            <Checkbox id={`task-${task.id}`} className='mt-1' />
            <div>
              <div className='font-medium text-base'>{task.title}</div>
              <div className='text-sm text-muted-foreground mt-2'>{task.description}</div>
            </div>
          </div>
          {task.assignedTo ? (
            <div className='text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full'>
              {task.assignedTo}
            </div>
          ) : (
            <div className='text-xs bg-destructive/10 text-destructive px-2 py-1 rounded-full'>Unassigned</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

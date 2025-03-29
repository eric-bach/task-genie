'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

type Task = {
  id: string;
  title: string;
  description: string;
  status: 'To Do' | 'In Progress' | 'Done';
  assignedTo?: string;
  estimatedHours: number;
};

export function TasksDisplay() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Simulate loading tasks that would be generated from the user story
  useEffect(() => {
    const timer = setTimeout(() => {
      setTasks([
        {
          id: 'TASK-001',
          title: 'Design database schema',
          description: 'Create the database schema to support the new feature',
          status: 'To Do',
          assignedTo: 'Jane Smith',
          estimatedHours: 4,
        },
        {
          id: 'TASK-002',
          title: 'Implement API endpoints',
          description: 'Create the necessary API endpoints for the feature',
          status: 'To Do',
          assignedTo: 'John Doe',
          estimatedHours: 6,
        },
        {
          id: 'TASK-003',
          title: 'Create UI components',
          description: 'Develop the UI components needed for the feature',
          status: 'To Do',
          assignedTo: 'Alex Johnson',
          estimatedHours: 8,
        },
        {
          id: 'TASK-004',
          title: 'Write unit tests',
          description: 'Create comprehensive unit tests for the new functionality',
          status: 'To Do',
          estimatedHours: 5,
        },
        {
          id: 'TASK-005',
          title: 'Perform integration testing',
          description: 'Test the integration of all components',
          status: 'To Do',
          estimatedHours: 4,
        },
        {
          id: 'TASK-006',
          title: 'Update documentation',
          description: 'Update the technical documentation with the new feature details',
          status: 'To Do',
          assignedTo: 'Sarah Williams',
          estimatedHours: 3,
        },
        {
          id: 'TASK-007',
          title: 'Conduct code review',
          description: 'Review the code for quality and adherence to standards',
          status: 'To Do',
          assignedTo: 'Michael Brown',
          estimatedHours: 2,
        },
      ]);
      setIsLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  // Calculate total estimated hours
  const totalHours = tasks.reduce((sum, task) => sum + task.estimatedHours, 0);

  return (
    <Card className='w-full h-full flex flex-col overflow-hidden'>
      <CardHeader className='flex-shrink-0'>
        <CardTitle>Generated Tasks</CardTitle>
        <CardDescription>Tasks automatically generated from the user story</CardDescription>
      </CardHeader>
      <CardContent className='flex-grow flex flex-col overflow-hidden pb-6'>
        {isLoading ? (
          <div className='flex flex-col items-center justify-center h-full space-y-4'>
            <div className='h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin'></div>
            <p className='text-sm text-muted-foreground'>Generating tasks...</p>
          </div>
        ) : (
          <>
            <div className='flex justify-between items-center mb-4 flex-shrink-0'>
              <div className='flex items-center space-x-2'>
                <Badge variant='outline'>{tasks.length} Tasks</Badge>
                <Badge variant='outline'>{totalHours} Hours</Badge>
              </div>
            </div>

            <ScrollArea className='flex-grow overflow-auto pr-4'>
              <div className='space-y-4 pb-4'>
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
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
      <CardContent className='p-5'>
        <div className='flex items-start justify-between'>
          <div className='flex items-start space-x-3'>
            <Checkbox id={`task-${task.id}`} className='mt-1' />
            <div>
              <div className='font-medium text-base'>{task.title}</div>
              <div className='text-sm text-muted-foreground mt-2'>{task.description}</div>
            </div>
          </div>
          <Badge variant='outline' className='text-sm'>
            {task.estimatedHours}h
          </Badge>
        </div>

        <div className='flex justify-between items-center mt-4'>
          <div className='text-xs text-muted-foreground'>{task.id}</div>
          {task.assignedTo ? (
            <div className='text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full'>{task.assignedTo}</div>
          ) : (
            <div className='text-xs bg-destructive/10 text-destructive px-2 py-1 rounded-full'>Unassigned</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const formSchema = z.object({
  title: z.string().min(5, {
    message: 'Title must be at least 5 characters.',
  }),
  description: z.string().min(10, {
    message: 'Description must be at least 10 characters.',
  }),
  acceptanceCriteria: z.string().min(10, {
    message: 'Acceptance criteria must be at least 10 characters.',
  }),
});

export function UserStoryForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
      acceptanceCriteria: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);

    // Simulate API call to Azure DevOps
    try {
      // In a real application, you would make an API call to Azure DevOps here
      await new Promise((resolve) => setTimeout(resolve, 1500));

      console.log('Form values:', values);

      toast.success('User Story Created', {
        description: `Successfully created user story: ${values.title}`,
      });

      form.reset();
    } catch (error) {
      toast.error('Error', {
        description: 'Failed to create user story. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className='w-full h-full flex flex-col'>
      <CardHeader>
        <CardTitle>New User Story</CardTitle>
        <CardDescription>Create a new user story in your Azure DevOps project.</CardDescription>
      </CardHeader>
      <CardContent className='flex-grow'>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6 h-full flex flex-col'>
            <div className='space-y-6 flex-grow'>
              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder='As a user, I want to...' {...field} />
                    </FormControl>
                    <FormDescription>A concise title for your user story.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='description'
                render={({ field }) => (
                  <FormItem className='flex-grow'>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder='Provide a detailed description of the user story...' className='min-h-[120px]' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='acceptanceCriteria'
                render={({ field }) => (
                  <FormItem className='flex-grow'>
                    <FormLabel>Acceptance Criteria</FormLabel>
                    <FormControl>
                      <Textarea placeholder='List the acceptance criteria...' className='min-h-[180px]' {...field} />
                    </FormControl>
                    <FormDescription>Define what conditions must be met for this story to be considered complete.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div>
              <Button type='submit' className='w-full' disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Creating...
                  </>
                ) : (
                  'Create User Story'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
      <CardFooter className='flex justify-between border-t pt-6'>
        <Button variant='outline' onClick={() => form.reset()}>
          Reset Form
        </Button>
      </CardFooter>
    </Card>
  );
}

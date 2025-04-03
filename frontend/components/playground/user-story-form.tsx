'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

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
  // AI settings
  aiPrompt: z.string().min(5, {
    message: 'AI prompt must be at least 5 characters.',
  }),
  maxTokens: z.number().min(256).max(4096),
  temperature: z.number().min(0).max(1),
  topP: z.number().min(0.1).max(1),
});

export async function callWebhookAPI(userId: string, title: string, description: string, acceptanceCriteria: string) {
  const apiUrl = `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}/test`;
  const apiKey = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY || '';

  try {
    const body = {
      // TODO: Add prompt here
      // prompt: {
      //   evaluateUserStoryPrompt: // Prompt to evaluate user story
      //   defineTaskPrompt:         // Prompt to define tasks
      // inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
      // },
      resource: {
        // TODO: How to tell the backend to just generate tasks and not to create them in ADO
        workItemId: 0,
        revision: {
          fields: {
            'System.ChangedBy': userId,
            'System.Title': title,
            'System.Description': description,
            'Microsoft.VSTS.Common.AcceptanceCriteria': acceptanceCriteria,
          },
        },
      },
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    // TODO Handle response
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Response:', data);
  } catch (error) {
    console.error('Error calling webhook:', error);
  }
}

export function UserStoryForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
      acceptanceCriteria: '',
      aiPrompt: 'Generate tasks for the user story with detailed descriptions and estimated hours.',
      maxTokens: 2048,
      temperature: 0.7,
      topP: 0.9,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);

    // Simulate API call to Azure DevOps
    try {
      console.log('Form values:', values);
      const { title, description, acceptanceCriteria } = values;

      // // In a real application, you would make an API call to Azure DevOps here
      // await new Promise((resolve) => setTimeout(resolve, 1500));

      const userId = user.signInDetails?.loginId || '';

      const result = await callWebhookAPI(userId, title, description, acceptanceCriteria);
      console.log('Result', result);

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
    <Card className='w-full h-full flex flex-col overflow-hidden'>
      <CardHeader className='flex-shrink-0'>
        <CardTitle>New User Story</CardTitle>
        <CardDescription>Test the model's task generation capabilities with a new user story.</CardDescription>
      </CardHeader>
      <CardContent className='flex-grow overflow-hidden'>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='h-full flex flex-col'>
            <ScrollArea className='flex-grow pr-4'>
              <div className='space-y-6 pb-4'>
                <Accordion
                  type='single'
                  collapsible
                  className='w-full mb-4'
                  onValueChange={(value) => setIsAccordionOpen(!!value)}
                >
                  <AccordionItem value='ai-settings'>
                    <AccordionTrigger>
                      <div className='font-semibold'>AI Prompt Customization</div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Card>
                        <CardContent className='pt-6'>
                          <div className='space-y-6'>
                            <FormField
                              control={form.control}
                              name='aiPrompt'
                              render={({ field }) => (
                                <FormItem className='space-y-2'>
                                  <div className='flex items-center justify-between'>
                                    <FormLabel className='text-base'>Custom Prompt</FormLabel>
                                    <div className='flex items-center text-sm text-muted-foreground'>
                                      <Sparkles className='h-3.5 w-3.5 mr-1' />
                                      AI Prompt
                                    </div>
                                  </div>
                                  <FormControl>
                                    <Textarea
                                      placeholder='Enter your custom prompt for task generation...'
                                      className='min-h-[100px] resize-none'
                                      {...field}
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Customize how the AI generates tasks from your user story.
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
                              <FormField
                                control={form.control}
                                name='maxTokens'
                                render={({ field }) => (
                                  <FormItem className='space-y-2'>
                                    <div className='flex items-center justify-between'>
                                      <FormLabel className='text-base'>Max Tokens</FormLabel>
                                      <span className='text-sm text-muted-foreground'>{field.value}</span>
                                    </div>
                                    <FormControl>
                                      <Slider
                                        min={256}
                                        max={4096}
                                        step={128}
                                        value={[field.value]}
                                        onValueChange={(value) => field.onChange(value[0])}
                                      />
                                    </FormControl>
                                    <FormDescription className='text-xs'>
                                      Maximum length of generated content (256-4096)
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name='temperature'
                                render={({ field }) => (
                                  <FormItem className='space-y-2'>
                                    <div className='flex items-center justify-between'>
                                      <FormLabel className='text-base'>Temperature</FormLabel>
                                      <span className='text-sm text-muted-foreground'>{field.value.toFixed(1)}</span>
                                    </div>
                                    <FormControl>
                                      <Slider
                                        min={0}
                                        max={1}
                                        step={0.1}
                                        value={[field.value]}
                                        onValueChange={(value) => field.onChange(value[0])}
                                      />
                                    </FormControl>
                                    <FormDescription className='text-xs'>
                                      Controls randomness (0 = deterministic, 1 = creative)
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name='topP'
                                render={({ field }) => (
                                  <FormItem className='space-y-2'>
                                    <div className='flex items-center justify-between'>
                                      <FormLabel className='text-base'>Top P</FormLabel>
                                      <span className='text-sm text-muted-foreground'>{field.value.toFixed(1)}</span>
                                    </div>
                                    <FormControl>
                                      <Slider
                                        min={0.1}
                                        max={1}
                                        step={0.1}
                                        value={[field.value]}
                                        onValueChange={(value) => field.onChange(value[0])}
                                      />
                                    </FormControl>
                                    <FormDescription className='text-xs'>
                                      Controls diversity of output (0.1-1.0)
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <h3 className='font-semibold'>User Story Details</h3>

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
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Provide a detailed description of the user story...'
                          className='min-h-[120px]'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='acceptanceCriteria'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Acceptance Criteria</FormLabel>
                      <FormControl>
                        <Textarea placeholder='List the acceptance criteria...' className='min-h-[180px]' {...field} />
                      </FormControl>
                      <FormDescription>
                        Define what conditions must be met for this story to be considered complete.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </ScrollArea>

            <div className='pt-6 flex-shrink-0 flex justify-end space-x-4'>
              <Button variant='outline' onClick={() => form.reset()}>
                Reset Form
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Creating stuff...
                  </>
                ) : (
                  'Create User Story'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
      <CardFooter className='flex justify-between pt-6 flex-shrink-0'></CardFooter>
    </Card>
  );
}

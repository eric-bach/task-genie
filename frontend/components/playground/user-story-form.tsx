'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Loader2, Sparkles, Terminal } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { TasksDisplay } from './tasks-display';

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
  prompt: z.string().optional(),
  maxTokens: z.number().min(256).max(4096),
  temperature: z.number().min(0).max(1),
  topP: z.number().min(0.1).max(1),
});

export async function callWebhookAPI(values: z.infer<typeof formSchema>, userId: string) {
  const apiUrl = `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}`;
  const apiKey = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY || '';

  try {
    const { title, description, acceptanceCriteria, prompt, maxTokens, temperature, topP } = values;

    const body = {
      params: {
        prompt,
        maxTokens,
        temperature,
        topP,
      },
      resource: {
        workItemId: 0,
        revision: {
          fields: {
            'System.ChangedBy': userId,
            'System.IterationPath': 'test',
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

    const data = await response.json();
    //console.log('API response:', data);

    return data;
  } catch (error) {
    // console.error('Error calling webhook:', error);

    return { error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

export function UserStoryForm() {
  const { user } = useAuthenticator();

  const [isSubmitting, setIsSubmitting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>();
  const [tasks, setTasks] = useState([]);
  const [isAlertVisisble, setAlertVisibility] = useState(false);

  const backgroundColor =
    result && result.statusCode === 200
      ? 'bg-green-100 text-green-800 border-green-300' // Green for success
      : 'bg-red-100 text-red-800 border-red-300'; // Red for error

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title:
        'As a frequent traveler, I want to receive notifications about gate changes so that I can avoid missing my flight.',
      description:
        "Frequent travelers often face the challenge of keeping track of gate changes, which can occur unexpectedly and cause confusion and inconvenience. Missing a flight due to last-minute gate changes can be stressful and disruptive. By providing timely notifications about gate changes directly to travelers' mobile devices, we help ensure they are informed in real-time and can make their way to the new gate without delay.",
      acceptanceCriteria:
        'GIVEN a frequent traveler has a booked flight, WHEN a gate change occurs, THEN the traveler receives a notification with the updated gate information.',
      prompt: undefined,
      maxTokens: 2048,
      temperature: 0.5,
      topP: 0.9,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    setResult(undefined);
    setTasks([]);
    setAlertVisibility(false);

    try {
      const userId = user.signInDetails?.loginId || '';
      const result = await callWebhookAPI(values, userId);

      setResult(result);

      if (result.statusCode >= 200 && result.statusCode < 400) {
        //console.log('API call succeeded:', result);

        setTasks(result.body.tasks);

        toast.success('User Story is accepted', {
          description: `User story accepted and ${result.body.tasks.length} tasks were generated`,
        });
      } else {
        // console.error('Failed to call API: ', result.error);

        toast.error('User Story is not accepted', {
          description: 'Please see the reason for more details and correct the user story to try again',
        });
      }

      // form.reset();
    } catch (error) {
      toast.error('An unexpected error occurred', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setAlertVisibility(true);
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {isAlertVisisble && (
        <Alert className={`mb-4 ${backgroundColor}`}>
          <Terminal className='h-4 w-4' />
          <Button
            variant='ghost'
            onClick={() => setAlertVisibility(false)}
            className='absolute top-3 right-3 text-gray-500 hover:text-gray-800 focus:outline-none'
          >
            X
          </Button>
          <div>
            <AlertTitle>
              {result && result?.statusCode === 200 ? 'User story accepted' : 'User story not accepted'}
            </AlertTitle>
            <AlertDescription>
              {result && result?.statusCode === 200
                ? `A total of ${tasks.length} tasks have been generated`
                : result.body.workItemStatus.comment}
            </AlertDescription>
          </div>
        </Alert>
      )}
      <div className='flex w-full space-x-4'>
        <Card className='w-full h-full flex flex-col overflow-hidden'>
          <CardHeader className='flex-shrink-0'>
            <CardTitle>New User Story</CardTitle>
            <CardDescription>Test the model&apos;s task generation capabilities with a new user story.</CardDescription>
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
                                  disabled={isSubmitting}
                                  name='prompt'
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
                                          placeholder='Enter your custom prompt for task generation. If not provided, the default task-genie prompt will be used.'
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
                                    disabled={isSubmitting}
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
                                    disabled={isSubmitting}
                                    name='temperature'
                                    render={({ field }) => (
                                      <FormItem className='space-y-2'>
                                        <div className='flex items-center justify-between'>
                                          <FormLabel className='text-base'>Temperature</FormLabel>
                                          <span className='text-sm text-muted-foreground'>
                                            {field.value.toFixed(1)}
                                          </span>
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
                                    disabled={isSubmitting}
                                    name='topP'
                                    render={({ field }) => (
                                      <FormItem className='space-y-2'>
                                        <div className='flex items-center justify-between'>
                                          <FormLabel className='text-base'>Top P</FormLabel>
                                          <span className='text-sm text-muted-foreground'>
                                            {field.value.toFixed(1)}
                                          </span>
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
                      disabled={isSubmitting}
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
                      disabled={isSubmitting}
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
                      disabled={isSubmitting}
                      name='acceptanceCriteria'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Acceptance Criteria</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder='List the acceptance criteria...'
                              className='min-h-[180px]'
                              {...field}
                            />
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
                  <Button type='submit' disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Generating...
                      </>
                    ) : (
                      'Generate Tasks'
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
          <CardFooter className='flex justify-between pt-6 flex-shrink-0'></CardFooter>
        </Card>

        <TasksDisplay isSubmitting={isSubmitting} tasks={tasks} />
      </div>
    </>
  );
}

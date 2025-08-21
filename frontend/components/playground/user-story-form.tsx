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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { TasksDisplay } from './tasks-display';
import { AREA_PATHS, BUSINESS_UNITS, SYSTEMS } from '@/lib/constants';

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
  // Azure DevOps fields
  areaPath: z.string().min(1, {
    message: 'Area Path is required.',
  }),
  businessUnit: z.string().min(1, {
    message: 'Business Unit is required.',
  }),
  system: z.string().min(1, {
    message: 'System is required.',
  }),
  // AI settings
  prompt: z.string().optional(),
  maxTokens: z.number().min(256).max(4096),
  temperature: z.number().min(0).max(1),
  topP: z.number().min(0.1).max(1),
});

export async function generateTasks(values: z.infer<typeof formSchema>, userId: string) {
  const baseUrl = `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}`;
  const backendUrl = `${baseUrl}/executions`;
  const apiKey = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY || '';

  try {
    const {
      title,
      description,
      acceptanceCriteria,
      areaPath,
      businessUnit,
      system,
      prompt,
      maxTokens,
      temperature,
      topP,
    } = values;

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
            'System.Title': title,
            'System.Description': description,
            'Microsoft.VSTS.Common.AcceptanceCriteria': acceptanceCriteria,
            'System.TeamProject': 'test',
            'System.AreaPath': areaPath,
            // TODO Change this to Custom.BusinessUnit when moving to AMA-Ent
            'Custom.BusinessUnit2': businessUnit,
            // TODO Change this to Custom.System when moving to AMA-Ent
            'Custom.System2': system,
          },
        },
      },
    };

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log('API response:', data);

    // Get the step function execution name from the execution ARN
    const executionName = data.executionArn.split(':').slice(-2)[0] || '';

    return {
      statusCode: response.status,
      data,
      executionName,
    };
  } catch (error) {
    // console.error('Error calling webhook:', error);

    return { error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

export async function pollForResults(executionName: string, maxAttempts: number = 36, intervalMs: number = 5000) {
  const apiUrl = `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}/executions/${executionName}`;
  const apiKey = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY || '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
      });

      const data = await response.json();

      console.log('Polling for results:', data);

      // Check if execution is complete
      if (data.status === 'completed') {
        if (data.result.executionResult === 'SUCCEEDED') {
          return {
            statusCode: 200,
            body: data.output || data.result,
          };
        } else if (data.result.executionResult === 'FAILED') {
          return {
            statusCode: 400,
            body: {
              workItemStatus: {
                comment: data.result.workItemComment || 'Execution failed',
              },
            },
          };
        } else {
          return {
            statusCode: 500,
            body: {
              workItemStatus: {
                comment: 'Unknown error occurred',
              },
            },
          };
        }
      }

      // If still running, wait before next poll
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    } catch (error) {
      console.error('Error polling for results:', error);

      // If this is the last attempt, return error
      if (attempt === maxAttempts - 1) {
        return {
          statusCode: 500,
          body: {
            workItemStatus: {
              comment: 'Failed to get execution results',
            },
          },
        };
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // Timeout after max attempts
  return {
    statusCode: 408,
    body: {
      workItemStatus: {
        comment: 'Execution timed out - please try again',
      },
    },
  };
}

export function UserStoryForm() {
  const { user } = useAuthenticator();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingMessage, setPollingMessage] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>();
  const [tasks, setTasks] = useState([]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title:
        'As a frequent traveler, I want to receive notifications about gate changes so that I can avoid missing my flight.',
      description:
        "Frequent travelers often face the challenge of keeping track of gate changes, which can occur unexpectedly and cause confusion and inconvenience. Missing a flight due to last-minute gate changes can be stressful and disruptive. By providing timely notifications about gate changes directly to travelers' mobile devices, we help ensure they are informed in real-time and can make their way to the new gate without delay.",
      acceptanceCriteria:
        'GIVEN a frequent traveler has a booked flight and has opted in for notifications WHEN a gate change occurs within 2 hours of departure THEN the traveler receives a notification within 1 minute containing flight number, old gate, new gate, and departure time. GIVEN a traveler receives a gate change notification WHEN they tap the notification THEN the app opens to the flight details screen.',
      areaPath: '',
      businessUnit: '',
      system: '',
      prompt: undefined,
      maxTokens: 4096,
      temperature: 0.5,
      topP: 0.9,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    setIsPolling(false);
    setPollingMessage('');
    setResult(undefined);
    setTasks([]);

    try {
      const userId = user.signInDetails?.loginId || '';

      // Step 1: Submit the request
      const initialResponse = await generateTasks(values, userId);

      if (initialResponse.error) {
        throw new Error(initialResponse.error);
      }

      // Step 2: Check if we got a 202 (accepted) response with execution ID
      if (initialResponse.statusCode === 202) {
        setIsSubmitting(false);
        setIsPolling(true);
        setPollingMessage('Request submitted successfully. Waiting for results...');

        const executionName = initialResponse.executionName;

        if (!executionName) {
          throw new Error('No execution name received from API');
        }

        // Step 3: Poll for results
        const maxAttempts = 30;
        const intervalMs = 2000;

        const pollResults = async () => {
          try {
            const pollResponse = await pollForResults(executionName, maxAttempts, intervalMs);
            setResult(pollResponse);

            if (pollResponse.statusCode === 200) {
              setTasks(pollResponse.body.tasks || []);

              toast.success('User Story is accepted', {
                description: `User story accepted and ${pollResponse.body.tasks?.length || 0} tasks were generated`,
              });
            } else {
              toast.error('User Story is not accepted', {
                description: 'Please see the reason for more details and correct the user story to try again',
              });
            }
          } catch (error) {
            setResult({
              statusCode: 500,
              body: {
                workItemStatus: {
                  comment: error instanceof Error ? error.message : 'Unknown error occurred during polling',
                },
              },
            });

            toast.error('An error occurred while processing', {
              description: error instanceof Error ? error.message : 'Unknown error occurred',
            });
          } finally {
            setIsPolling(false);
            setPollingMessage('');
          }
        };

        // Start polling
        await pollResults();
      } else {
        // Handle immediate response (if API changed behavior)
        setResult(initialResponse);

        if (initialResponse.statusCode && initialResponse.statusCode >= 200 && initialResponse.statusCode < 400) {
          const tasks = initialResponse.data?.tasks || [];
          setTasks(tasks);

          toast.success('User Story is accepted', {
            description: `User story accepted and ${tasks.length} tasks were generated`,
          });
        } else {
          toast.error('User Story is not accepted', {
            description: 'Please see the reason for more details and correct the user story to try again',
          });
        }
      }

      // form.reset();
    } catch (error) {
      toast.error('An unexpected error occurred', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
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
                                  disabled={isSubmitting || isPolling}
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
                                    disabled={isSubmitting || isPolling}
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
                                    disabled={isSubmitting || isPolling}
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
                                    disabled={isSubmitting || isPolling}
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
                      disabled={isSubmitting || isPolling}
                      name='areaPath'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Area Path</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Select an area path' />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {AREA_PATHS.map((areaPath) => (
                                <SelectItem key={areaPath} value={areaPath}>
                                  {areaPath}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>Select the Area Path for the user story</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      disabled={isSubmitting || isPolling}
                      name='businessUnit'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Unit</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Select a business unit' />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {BUSINESS_UNITS.map((unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>Select the Business Unit for the user story</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      disabled={isSubmitting || isPolling}
                      name='system'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>System</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Select a system' />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {SYSTEMS.map((system) => (
                                <SelectItem key={system} value={system}>
                                  {system}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>Select the system for the user story</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      disabled={isSubmitting || isPolling}
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
                      disabled={isSubmitting || isPolling}
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
                      disabled={isSubmitting || isPolling}
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
                  {isPolling && pollingMessage && (
                    <div className='flex items-center text-sm text-muted-foreground mr-4'>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {pollingMessage}
                    </div>
                  )}
                  <Button type='submit' disabled={isSubmitting || isPolling}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Submitting...
                      </>
                    ) : isPolling ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Processing...
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

        <TasksDisplay isSubmitting={isSubmitting || isPolling} tasks={tasks} result={result} />
      </div>
    </>
  );
}

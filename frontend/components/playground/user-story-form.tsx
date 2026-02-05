'use client';

import { useState, useRef } from 'react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { PromptSuffixInfo } from '@/components/ui/prompt-suffix-info';
import { useAuth } from '@/contexts/auth-context';
import { TasksDisplay } from './tasks-display';
import { AREA_PATHS, BUSINESS_UNITS, SYSTEMS } from '@/lib/constants';

const MAX_OUTPUT_TOKENS = 10240;

const formSchema = z.object({
  workItemType: z.enum(['User Story']).default('User Story'),
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
  maxTokens: z.number().min(256).max(MAX_OUTPUT_TOKENS),
  // Claude 4.5 Sonnet only supports temperature or topP, not both
  parameterMode: z.enum(['temperature', 'topP']),
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
      parameterMode,
      temperature,
      topP,
    } = values;

    // Only send the active parameter based on parameterMode
    const aiParams: {
      prompt?: string;
      maxTokens: number;
      temperature?: number;
      topP?: number;
      preview: boolean;
    } = {
      prompt,
      maxTokens,
      preview: true,
    };

    if (parameterMode === 'temperature') {
      aiParams.temperature = temperature;
    } else {
      aiParams.topP = topP;
    }

    const body = {
      params: aiParams,
      resource: {
        workItemId: 0,
        rev: 1,
        revision: {
          fields: {
            'System.WorkItemType': 'User Story',
            'System.ChangedBy': userId,
            'System.Title': title,
            'System.Description': description,
            'Microsoft.VSTS.Common.AcceptanceCriteria': acceptanceCriteria,
            'System.TeamProject': 'test',
            'System.AreaPath': areaPath,
            'System.IterationPath': 'test', // Hardcode for test
            'Custom.AMAValueArea': 'test',
            'Custom.BusinessUnit': businessUnit,
            'Custom.System': system,
          },
        },
      },
    };

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log('API response:', data);

    // Get the step function execution id from the execution ARN
    // ARN format: arn:aws:states:region:account-id:execution:stateMachineName:executionId
    // The executionId can contain colons, so we need to extract everything after the 7th colon
    const arnParts = data.executionArn.split(':');
    const executionId = arnParts.slice(7).join(':') || '';
    console.log('Extracted execution id:', executionId, 'from ARN:', data.executionArn);

    return {
      statusCode: response.status,
      data,
      executionId: executionId,
    };
  } catch (error) {
    // console.error('Error calling webhook:', error);

    return {
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function pollForResults(executionId: string, maxAttempts: number = 36, intervalMs: number = 5000) {
  const encodedExecutionId = encodeURIComponent(executionId);
  const apiUrl = `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}/executions/${encodedExecutionId}`;
  const apiKey = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY || '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const data = await response.json();

      console.log(`Polling for results (attempt ${attempt + 1}/${maxAttempts}) for execution: ${executionId}`, data);

      // Check if execution is complete
      if (data.status === 'completed') {
        if (data.result.executionResult === 'SUCCEEDED') {
          // Check if the business logic actually succeeded by looking at the output
          const output = data.output || data.result;
          console.log('Execution succeeded, checking output:', output);

          // If the output contains a rejection or error message, treat it as a failure
          if (
            output.workItemStatus &&
            output.workItemStatus.comment &&
            (output.workItemStatus.comment.toLowerCase().includes('reject') ||
              output.workItemStatus.comment.toLowerCase().includes('error') ||
              output.workItemStatus.comment.toLowerCase().includes('fail'))
          ) {
            return {
              statusCode: 400,
              body: output,
            };
          }

          return {
            statusCode: 200,
            body: output,
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
  const { user } = useAuth();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingMessage, setPollingMessage] = useState('');
  const [currentExecutionId, setCurrentExecutionId] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>();
  const [tasks, setTasks] = useState([]);
  const [adoError, setAdoError] = useState(false);
  const [adoSuccess, setAdoSuccess] = useState(false);
  const [adoId, setAdoId] = useState('');
  const adoInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workItemType: 'User Story',
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
      maxTokens: 8192,
      parameterMode: 'temperature' as const,
      temperature: 0.5,
      topP: 0.9,
    },
  });

  async function executePoll(executionId: string) {
    const maxAttempts = 36;
    const intervalMs = 5000;

    try {
      const pollResponse = await pollForResults(executionId, maxAttempts, intervalMs);
      setResult(pollResponse);

      if (pollResponse.statusCode === 200) {
        const tasks = pollResponse.body.workItems || [];
        console.log('Setting tasks from poll response:', tasks);
        setTasks(tasks);

        if (tasks.length > 0) {
          toast.success('User Story is accepted', {
            description: `User story accepted and ${tasks.length} tasks were generated`,
          });
        } else {
          toast.warning('User Story processed', {
            description: 'User story was processed but no tasks were generated',
          });
        }
      } else if (pollResponse.statusCode === 408) {
        // Still timed out - result will show the timeout message with retry button
        toast.warning('Request still processing', {
          description: 'The request is still taking longer than expected. You can try again.',
        });
      } else {
        console.log('Poll response indicates failure:', pollResponse);
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
  }

  async function handleRetryPolling() {
    if (!currentExecutionId) return;

    setIsPolling(true);
    setPollingMessage('Checking for results...');

    await executePoll(currentExecutionId);
  }

  async function fetchAdoWorkItem(id: string) {
    const apiKey = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY || '';

    if (!id) {
      setAdoError(false);
      setAdoSuccess(false);
      return;
    }

    try {
      setAdoError(false);
      setAdoSuccess(false);
      // Call the Next.js API route instead of directly calling the backend
      const response = await fetch(`/api/work-items/${id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        setAdoError(true);
        if (response.status === 404) {
          toast.error('Work item not found');
        } else {
          toast.error('Failed to fetch work item details');
        }

        // Clear value on error
        setAdoId('');
        return;
      }

      const data = await response.json();

      if (data) {
        form.setValue('title', data.title || '');
        form.setValue('description', data.description || '');
        form.setValue('acceptanceCriteria', data.acceptanceCriteria || '');

        setAdoSuccess(true);
        toast.success('Work item details fetched successfully');
      }
    } catch (error) {
      setAdoError(true);
      console.error('Error fetching work item:', error);
      toast.error('Error fetching work item details');

      // Clear value on error
      setAdoId('');
    }
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    setIsPolling(false);
    setPollingMessage('');
    setCurrentExecutionId('');
    setResult(undefined);
    setTasks([]);

    try {
      const userId = user?.email || '';

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

        const executionId = initialResponse.executionId;

        if (!executionId) {
          throw new Error('No execution ID received from API');
        }

        setCurrentExecutionId(executionId);

        // Step 3: Poll for results
        await executePoll(executionId);
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
    <div className='container mx-auto py-10 px-4 min-h-screen'>
      <h1 className='text-2xl font-bold mb-2'>Test Playground (*User Stories only)</h1>
      <p className='text-md text-muted-foreground mb-8'>
        Use this playground to experiment with different AI prompts and inference parameters to test how Task Genie
        generates tasks.
      </p>
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
                                      <PromptSuffixInfo />
                                      <FormDescription>
                                        Customize how the AI generates tasks from your user story.
                                      </FormDescription>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />

                                <Alert className='mb-4'>
                                  <Info className='h-4 w-4' />
                                  <AlertDescription>
                                    <strong>Claude 4.5 Sonnet</strong> only supports either Temperature or Top P, not
                                    both.
                                  </AlertDescription>
                                </Alert>

                                <div className='grid grid-cols-1 md:grid-cols-2 gap-6 mb-6'>
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
                                            max={MAX_OUTPUT_TOKENS}
                                            step={128}
                                            value={[field.value]}
                                            onValueChange={(value) => field.onChange(value[0])}
                                          />
                                        </FormControl>
                                        <FormDescription className='text-xs'>
                                          Maximum length of generated content (256-${MAX_OUTPUT_TOKENS} tokens)
                                        </FormDescription>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />

                                  <FormField
                                    control={form.control}
                                    disabled={isSubmitting || isPolling}
                                    name='parameterMode'
                                    render={({ field }) => (
                                      <FormItem className='space-y-2'>
                                        <FormLabel className='text-base'>Inference Parameter</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                          <FormControl>
                                            <SelectTrigger>
                                              <SelectValue />
                                            </SelectTrigger>
                                          </FormControl>
                                          <SelectContent>
                                            <SelectItem value='temperature'>Temperature</SelectItem>
                                            <SelectItem value='topP'>Top P</SelectItem>
                                          </SelectContent>
                                        </Select>
                                        <FormDescription className='text-xs'>
                                          Select which inference parameter to use
                                        </FormDescription>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>

                                {form.watch('parameterMode') === 'temperature' && (
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
                                          Controls randomness: 0 = deterministic and focused, 1 = creative and diverse
                                        </FormDescription>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                )}

                                {form.watch('parameterMode') === 'topP' && (
                                  <FormField
                                    control={form.control}
                                    disabled={isSubmitting || isPolling}
                                    name='topP'
                                    render={({ field }) => (
                                      <FormItem className='space-y-2'>
                                        <div className='flex items-center justify-between'>
                                          <FormLabel className='text-base'>Top P (Nucleus Sampling)</FormLabel>
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
                                          Controls diversity: 0.1 = focused on most likely words, 1.0 = considers all
                                          possibilities
                                        </FormDescription>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                )}
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className='flex items-end gap-4'>
                      <div className='flex-[2]'>
                        <div className='space-y-2'>
                          <label className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                            ADO Work Item ID (optional)
                          </label>
                          <Input
                            placeholder='ADO Work Item ID'
                            id='ado-id-input'
                            disabled={isSubmitting || isPolling}
                            ref={adoInputRef}
                            value={adoId}
                            onChange={(e) => setAdoId(e.target.value)}
                            aria-invalid={adoError}
                            className={adoError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                fetchAdoWorkItem(adoId);
                              }
                            }}
                            onBlur={() => {
                              // Only fetch if we have a value to avoid loop on clearing
                              if (adoId) {
                                fetchAdoWorkItem(adoId);
                              }
                            }}
                          />
                          <p className='text-[0.8rem] text-muted-foreground'>
                            Enter an ADO Work Item ID to pre-populate Title, Description, and Acceptance Criteria.
                          </p>
                        </div>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      disabled={isSubmitting || isPolling}
                      name='title'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input
                              placeholder='As a user, I want to...'
                              className={adoSuccess ? 'border-green-500 focus-visible:ring-green-500' : ''}
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
                      name='description'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder='Provide a detailed description of the user story...'
                              className={`min-h-[120px] ${adoSuccess ? 'border-green-500 focus-visible:ring-green-500' : ''}`}
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
                              className={`min-h-[180px] ${adoSuccess ? 'border-green-500 focus-visible:ring-green-500' : ''}`}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </ScrollArea>

                <div className='pt-6 flex-shrink-0 flex justify-end items-center space-x-4'>
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

        <TasksDisplay
          isSubmitting={isSubmitting || isPolling}
          tasks={tasks}
          result={result}
          onRetry={handleRetryPolling}
          canRetry={!!currentExecutionId && !isPolling && !isSubmitting}
        />
      </div>
    </div>
  );
}

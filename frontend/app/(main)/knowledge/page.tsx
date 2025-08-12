'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Upload, FileText, X, Check, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Define dropdown options
const AREAS = ['eric-test'];
const BUSINESS_UNITS = ['Membership', 'Registries', 'Rewards'];
const SYSTEMS = ['ARAR', 'Gift Card System', 'iMIS', 'L2', 'VRAR'];

// Define accepted file types and max size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];

interface MetadataPayload {
  mode: 'userStory' | 'taskGeneration';
  fileName: string;
  fileSize: number;
  fileType: string;
  s3Key: string;
  s3Bucket: string;
  uploadedAt: string;
  area: string;
  businessUnit?: string;
  system?: string;
}

const formSchema = z
  .object({
    mode: z.enum(['userStory', 'taskGeneration']),
    area: z.string().optional(),
    businessUnit: z.string().optional(),
    system: z.string().optional(),
    file: z
      .any()
      .refine((files) => files?.length > 0, 'File is required')
      .refine((files) => files?.[0]?.size <= MAX_FILE_SIZE, 'File size must be less than 10MB')
      .refine(
        (files) => ACCEPTED_FILE_TYPES.includes(files?.[0]?.type),
        'Only PDF, Word, Text, and Markdown files are allowed'
      ),
  })
  .refine(
    (data) => {
      // If mode is taskGeneration, require the dropdown fields
      if (data.mode === 'taskGeneration') {
        return data.area && data.businessUnit && data.system;
      }
      return true;
    },
    {
      message: 'Area, Business Unit, and System are required for Task Generation mode',
      path: ['area'], // This will show the error on the area field
    }
  );

type FormData = z.infer<typeof formSchema>;

export default function Knowledge() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: 'userStory',
      area: '',
      businessUnit: '',
      system: '',
    },
  });

  const onSubmit = async (data: FormData) => {
    setIsUploading(true);
    setUploadStatus('idle');

    try {
      const file = data.file[0];
      console.log('Uploading file:', file, data);

      // Step 1: Get presigned URL
      // For User Story mode, use area only; for Task Generation mode, use selected values
      const area = data.mode === 'userStory' ? 'agile-process' : data.area || '';

      // Build query parameters - only include businessUnit and system for Task Generation mode
      const queryParams = new URLSearchParams({
        area,
        file_name: file.name,
      });

      if (data.mode === 'taskGeneration') {
        if (data.businessUnit) queryParams.append('business_unit', data.businessUnit);
        if (data.system) queryParams.append('system', data.system);
      }

      const presignedResponse = await fetch(`/api/presigned-url?${queryParams.toString()}`, {
        method: 'GET',
      });

      if (!presignedResponse.ok) {
        const errorData = await presignedResponse.json();
        throw new Error(errorData.error || 'Failed to get presigned URL');
      }

      const { presignedurl, key, bucket } = await presignedResponse.json();

      // Step 2: Upload file directly to S3 using presigned URL
      const uploadResponse = await fetch(presignedurl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file to S3');
      }

      // Step 3: Create metadata payload for backend processing
      const metadataPayload: MetadataPayload = {
        mode: data.mode,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        s3Key: key,
        s3Bucket: bucket,
        uploadedAt: new Date().toISOString(),
        area,
      };

      // Only include businessUnit and system for Task Generation mode
      if (data.mode === 'taskGeneration') {
        if (data.businessUnit) metadataPayload.businessUnit = data.businessUnit;
        if (data.system) metadataPayload.system = data.system;
      }

      console.log('File uploaded successfully:', metadataPayload);

      setUploadStatus('success');
      form.reset();
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus('error');
    } finally {
      setIsUploading(false);
    }
  };

  const selectedFile = form.watch('file')?.[0];
  const currentMode = form.watch('mode');

  return (
    <div className='container mx-auto py-10 px-4 min-h-screen'>
      <div className='max-w-2xl mx-auto'>
        <h1 className='text-3xl font-bold mb-2'>Update Knowledge Base</h1>
        <p className='text-muted-foreground mb-8'>
          Upload documents to enhance the knowledge base. Supported formats: PDF, Word, Text, and Markdown files.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Upload Document</CardTitle>
            <CardDescription>Add new documents to improve user story and task recommendations.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
                <FormField
                  control={form.control}
                  name='mode'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Upload Mode</FormLabel>
                      <FormControl>
                        <Tabs value={field.value} onValueChange={field.onChange} className='w-full'>
                          <TabsList className='grid w-full grid-cols-2'>
                            <TabsTrigger
                              value='userStory'
                              className='data-[state=active]:bg-primary data-[state=active]:text-primary-foreground'
                            >
                              User Story Evaluation
                            </TabsTrigger>
                            <TabsTrigger
                              value='taskGeneration'
                              className='data-[state=active]:bg-primary data-[state=active]:text-primary-foreground'
                            >
                              Task Generation
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </FormControl>
                      <FormDescription>
                        {currentMode === 'userStory'
                          ? 'User story evaluation documents will be applied organization-wide for all user stories.'
                          : 'Task generation documents are specific to each team and will only be used for individual Azure DevOps boards matching the Area, Business Unit, and System.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {currentMode === 'taskGeneration' && (
                  <>
                    <FormField
                      control={form.control}
                      name='area'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Area</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Select an area' />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {AREAS.map((area) => (
                                <SelectItem key={area} value={area}>
                                  {area}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>Select the Area path from the AMA ADO user story template</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
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
                          <FormDescription>
                            Select the Business Unit from the AMA ADO user story template.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
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
                          <FormDescription>Select the system from the AMA ADO user story template.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                <FormField
                  control={form.control}
                  name='file'
                  render={({ field: { onChange, ...field } }) => (
                    <FormItem>
                      <FormLabel>Document File</FormLabel>
                      <FormControl>
                        <div className='space-y-4'>
                          <div className='border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center hover:border-muted-foreground/50 transition-colors'>
                            <input
                              type='file'
                              accept='.pdf,.doc,.docx,.txt,.md'
                              onChange={(e) => onChange(e.target.files)}
                              className='hidden'
                              id='file-upload'
                              {...field}
                            />
                            <label htmlFor='file-upload' className='cursor-pointer flex flex-col items-center gap-2'>
                              <Upload className='h-8 w-8 text-muted-foreground' />
                              <div className='text-sm'>
                                <span className='font-medium text-primary'>Click to upload</span>
                                <span className='text-muted-foreground'> or drag and drop</span>
                              </div>
                              <p className='text-xs text-muted-foreground'>
                                PDF, Word, Text, or Markdown files (max 10MB)
                              </p>
                            </label>
                          </div>

                          {selectedFile && (
                            <div className='flex items-center gap-3 p-3 bg-muted/50 rounded-lg'>
                              <FileText className='h-5 w-5 text-muted-foreground flex-shrink-0' />
                              <div className='flex-1 min-w-0'>
                                <p className='text-sm font-medium truncate'>{selectedFile.name}</p>
                                <p className='text-xs text-muted-foreground'>
                                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                onClick={() => onChange(null)}
                                className='flex-shrink-0'
                              >
                                <X className='h-4 w-4' />
                              </Button>
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormDescription>Upload a document to add to the knowledge base.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {uploadStatus === 'success' && (
                  <div className='flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700'>
                    <Check className='h-5 w-5' />
                    <span className='text-sm'>Document uploaded successfully!</span>
                  </div>
                )}

                {uploadStatus === 'error' && (
                  <div className='flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700'>
                    <AlertCircle className='h-5 w-5' />
                    <span className='text-sm'>Upload failed. Please try again.</span>
                  </div>
                )}

                <div className='flex justify-end'>
                  <Button type='submit' disabled={isUploading} className='min-w-[120px]'>
                    {isUploading ? (
                      <>
                        <div className='animate-spin rounded-full h-4 w-4 border-2 border-background border-t-transparent mr-2' />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className='h-4 w-4 mr-2' />
                        Upload
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

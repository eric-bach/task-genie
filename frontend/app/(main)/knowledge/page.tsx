'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Upload, FileText, X, Check, AlertCircle, RefreshCw, HardDrive, Trash2 } from 'lucide-react';
import { useAuthenticator } from '@aws-amplify/ui-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

import { AREA_PATHS, BUSINESS_UNITS, SYSTEMS } from '@/lib/constants';

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
  areaPath: string;
  businessUnit?: string;
  system?: string;
  username?: string;
}

interface KnowledgeDocument {
  key: string;
  fileName: string;
  size: number;
  sizeFormatted: string;
  lastModified: string;
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
}

const formSchema = z
  .object({
    mode: z.enum(['userStory', 'taskGeneration']),
    areaPath: z.string().optional(),
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
  .superRefine((data, ctx) => {
    // Only validate dropdown fields for taskGeneration mode
    if (data.mode === 'taskGeneration') {
      if (!data.areaPath || data.areaPath.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Select the Area Path from the AMA ADO user story template',
          path: ['areaPath'],
        });
      }
      if (!data.businessUnit || data.businessUnit.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Select the Business Unit from the AMA ADO user story template',
          path: ['businessUnit'],
        });
      }
      if (!data.system || data.system.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Select the system from the AMA ADO user story template',
          path: ['system'],
        });
      }
    }
  });

type FormData = z.infer<typeof formSchema>;

export default function Knowledge() {
  const { user } = useAuthenticator();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [totalSizeFormatted, setTotalSizeFormatted] = useState<string>('');
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<KnowledgeDocument | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPreviousPage, setHasPreviousPage] = useState(false);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [tokenStack, setTokenStack] = useState<string[]>([]); // track tokens for Previous

  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: 'taskGeneration',
      areaPath: undefined,
      businessUnit: undefined,
      system: undefined,
      file: null,
    },
  });

  // Auto-clear success message after 3 seconds
  useEffect(() => {
    if (uploadStatus === 'success') {
      const timer = setTimeout(() => {
        setUploadStatus('idle');
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [uploadStatus]);

  // Load documents on component mount
  useEffect(() => {
    fetchDocuments(1, pageSize);
  }, [pageSize]);

  // Clear validation errors when switching modes
  const watchMode = form.watch('mode');
  useEffect(() => {
    form.clearErrors();
  }, [form, watchMode]);

  // Function to fetch knowledge base documents
  const fetchDocuments = async (page: number = 1, size: number = 10, token?: string) => {
    setIsLoadingDocuments(true);
    setDocumentsError(null);

    try {
      // Build query parameters for pagination
      const params = new URLSearchParams({
        pageSize: size.toString(),
        pageNumber: page.toString(),
      });

      if (token) {
        params.append('nextToken', token);
      }

      const response = await fetch(`/api/knowledge-base?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
      setTotalSizeFormatted(data.totalSizeFormatted || '0 B');

      // Update pagination state
      if (data.pagination) {
        setCurrentPage(data.pagination.currentPage || 1);
        setPageSize(data.pagination.pageSize || 10);
        setHasNextPage(Boolean(data.pagination.nextToken));
        setHasPreviousPage((data.pagination.currentPage || 1) > 1);
        setNextToken(data.pagination.nextToken || undefined);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
      setDocumentsError(error instanceof Error ? error.message : 'Failed to load documents');
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  const goToNextPage = () => {
    if (hasNextPage && nextToken) {
      setTokenStack((prev) => [...prev, nextToken!]);
      fetchDocuments(currentPage + 1, pageSize, nextToken);
    }
  };

  const goToPreviousPage = () => {
    if (hasPreviousPage) {
      const prevTokens = [...tokenStack];
      prevTokens.pop(); // current nextToken
      const prevToken = prevTokens.pop();
      setTokenStack(prevTokens);
      fetchDocuments(currentPage - 1, pageSize, prevToken);
    }
  };

  const changePageSize = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when changing page size
    setTokenStack([]);
    fetchDocuments(1, newPageSize);
  };

  // Function to format date
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const confirmDelete = (document: KnowledgeDocument) => {
    setDocumentToDelete(document);
    setShowDeleteConfirm(true);
  };

  const deleteDocument = async () => {
    if (!documentToDelete) return;

    try {
      setDeletingKey(documentToDelete.key);
      const resp = await fetch(`/api/knowledge-base?key=${encodeURIComponent(documentToDelete.key)}`, {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Failed to delete document');
      }
      await fetchDocuments(currentPage, pageSize, nextToken);
      setShowDeleteConfirm(false);
      setDocumentToDelete(null);
      setDeleteConfirmationText('');
    } catch (e) {
      console.error('Delete failed', e);
      setDocumentsError(e instanceof Error ? e.message : 'Failed to delete document');
    } finally {
      setDeletingKey(null);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setDocumentToDelete(null);
    setDeleteConfirmationText('');
  };

  const onSubmit = async (data: FormData) => {
    setIsUploading(true);
    setUploadStatus('idle');

    try {
      const file = data.file[0];
      console.log('Uploading file:', file, data);

      // Step 1: Get presigned URL
      // For User Story mode, use area path only; for Task Generation mode, use selected values
      const areaPath = data.mode === 'userStory' ? 'agile-process' : data.areaPath || '';

      // Build query parameters - only include businessUnit and system for Task Generation mode
      const queryParams = new URLSearchParams({
        areaPath: areaPath,
        fileName: file.name,
      });

      if (data.mode === 'taskGeneration') {
        if (data.businessUnit) queryParams.append('businessUnit', data.businessUnit);
        if (data.system) queryParams.append('system', data.system);
      }

      // Add user information
      queryParams.append('username', user.signInDetails?.loginId || user.username);

      const presignedResponse = await fetch(`/api/knowledge-base/presigned-url?${queryParams.toString()}`, {
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
        areaPath: areaPath,
        username: user.signInDetails?.loginId || user.username,
      };

      // Only include businessUnit and system for Task Generation mode
      if (data.mode === 'taskGeneration') {
        if (data.businessUnit) metadataPayload.businessUnit = data.businessUnit;
        if (data.system) metadataPayload.system = data.system;
      }

      console.log('File uploaded successfully:', metadataPayload);

      setUploadStatus('success');
      form.reset({
        mode: data.mode, // Preserve the current mode instead of defaulting to 'userStory'
        areaPath: undefined,
        businessUnit: undefined,
        system: undefined,
        file: null,
      });

      // Clear the file input safely
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Refresh the documents list
      fetchDocuments(currentPage, pageSize, nextToken);
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
      <div className='max-w-4xl xl:max-w-6xl mx-auto'>
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
                              value='taskGeneration'
                              className='data-[state=active]:bg-primary data-[state=active]:text-primary-foreground'
                            >
                              Task Generation
                            </TabsTrigger>
                            <TabsTrigger
                              value='userStory'
                              className='data-[state=active]:bg-primary data-[state=active]:text-primary-foreground'
                            >
                              User Story Evaluation
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </FormControl>
                      <FormDescription>
                        {currentMode === 'userStory'
                          ? 'User story evaluation documents will be applied organization-wide for all user stories.'
                          : 'Task generation documents are specific to each team and will only be used for individual Azure DevOps boards matching the Area Path, Business Unit, and System.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {currentMode === 'taskGeneration' && (
                  <>
                    <FormField
                      control={form.control}
                      name='areaPath'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Area Path</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Select an area' />
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
                      name='businessUnit'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Unit</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ''}>
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
                      name='system'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>System</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ''}>
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
                              ref={fileInputRef}
                              type='file'
                              accept='.pdf,.doc,.docx,.txt,.md'
                              onChange={(e) => onChange(e.target.files)}
                              className='hidden'
                              id='file-upload'
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
                                onClick={() => {
                                  onChange(null);
                                  // Reset the actual file input element
                                  if (fileInputRef.current) {
                                    fileInputRef.current.value = '';
                                  }
                                }}
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

        {/* Knowledge Base Documents List */}
        <Card className='mt-8'>
          <CardHeader>
            <div className='space-y-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <CardTitle>Knowledge Base Documents</CardTitle>
                  <CardDescription className='pt-2'>
                    All documents in the knowledge base. It may take several minutes for recent document changes to be
                    indexed and reflected in the list.
                  </CardDescription>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => fetchDocuments(currentPage, pageSize, nextToken)}
                  disabled={isLoadingDocuments}
                  className='flex items-center gap-2'
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingDocuments ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {documentsError && (
              <div className='flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-4'>
                <AlertCircle className='h-5 w-5' />
                <span className='text-sm'>{documentsError}</span>
              </div>
            )}

            {isLoadingDocuments ? (
              <div className='space-y-3'>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className='flex items-center space-x-4'>
                    <Skeleton className='h-4 w-1/3' />
                    <Skeleton className='h-4 w-1/6' />
                    <Skeleton className='h-4 w-1/6' />
                    <Skeleton className='h-4 w-1/6' />
                    <Skeleton className='h-4 w-1/6' />
                  </div>
                ))}
              </div>
            ) : documents.length === 0 ? (
              <div className='text-center py-12'>
                <FileText className='h-12 w-12 text-muted-foreground mx-auto mb-4' />
                <h3 className='text-lg font-medium text-muted-foreground mb-2'>No documents found</h3>
                <p className='text-sm text-muted-foreground'>
                  If you recently uploaded a document it may still be indexing.
                </p>
              </div>
            ) : (
              <>
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead className='whitespace-nowrap'>Size</TableHead>
                        <TableHead className='whitespace-nowrap'>Uploaded By</TableHead>
                        <TableHead className='whitespace-nowrap'>Uploaded At</TableHead>
                        <TableHead className='whitespace-nowrap'>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((doc, index) => (
                        <TableRow key={doc.key || index}>
                          <TableCell>
                            <div className='flex items-center gap-2'>
                              <FileText className='h-4 w-4 text-muted-foreground' />
                              <div className='max-w-x'>
                                <p className='font-medium truncate'>{doc.fileName}</p>
                                <p className='text-xs text-muted-foreground truncate'>
                                  {doc.areaPath || '-'} / {doc.businessUnit || '-'} / {doc.system || '-'}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className='whitespace-nowrap'>
                            <div className='flex items-center gap-1 text-sm text-muted-foreground'>
                              {doc.sizeFormatted}
                            </div>
                          </TableCell>
                          <TableCell className='whitespace-nowrap'>
                            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                              {doc.username ? (
                                <div className='flex flex-col'>
                                  <span className='font-medium'>{doc.username}</span>
                                </div>
                              ) : (
                                '-'
                              )}
                            </div>
                          </TableCell>
                          <TableCell className='whitespace-nowrap'>
                            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                              {formatDate(doc.lastModified)}
                            </div>
                          </TableCell>
                          <TableCell className='whitespace-nowrap'>
                            <Button
                              variant='destructive'
                              size='sm'
                              onClick={() => confirmDelete(doc)}
                              disabled={deletingKey === doc.key}
                            >
                              {deletingKey === doc.key ? (
                                <div className='animate-spin rounded-full h-4 w-4 border-2 border-background border-t-transparent' />
                              ) : (
                                <div className='flex items-center gap-1'>
                                  <Trash2 className='h-4 w-4' />
                                  Delete
                                </div>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination Controls */}
                <div className='mt-6 flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm text-muted-foreground'>Page size:</span>
                    <Select value={pageSize.toString()} onValueChange={(value) => changePageSize(parseInt(value))}>
                      <SelectTrigger className='w-20'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='1'>1</SelectItem>
                        <SelectItem value='10'>10</SelectItem>
                        <SelectItem value='25'>25</SelectItem>
                        <SelectItem value='50'>50</SelectItem>
                        <SelectItem value='100'>100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={goToPreviousPage}
                      disabled={!hasPreviousPage || isLoadingDocuments}
                    >
                      Previous
                    </Button>

                    {/* Page number buttons removed for cursor-based pagination */}
                    <div className='flex items-center gap-1' />

                    <Button
                      variant='outline'
                      size='sm'
                      onClick={goToNextPage}
                      disabled={!hasNextPage || isLoadingDocuments}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                <div className='mt-4 flex items-center justify-between text-sm text-muted-foreground'>
                  <span>
                    Showing {documents.length} document{documents.length !== 1 ? 's' : ''} (Page {currentPage})
                  </span>
                  <div className='flex items-center gap-2'>
                    <HardDrive className='h-4 w-4' />
                    <span>Total Size: {totalSizeFormatted}</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && documentToDelete && (
          <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
            <div className='bg-background rounded-lg p-6 max-w-md w-full mx-4 shadow-lg'>
              <div className='flex items-center gap-3 mb-4'>
                <AlertCircle className='h-6 w-6 text-destructive' />
                <h3 className='text-lg font-semibold'>Confirm Deletion</h3>
              </div>
              <p className='text-muted-foreground mb-4'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-foreground'>"{documentToDelete.fileName}"</span>? This action cannot
                be undone.
              </p>

              <div className='mb-6'>
                <label htmlFor='delete-confirm' className='block text-sm font-medium text-foreground mb-2'>
                  Type "confirm" to proceed with deletion:
                </label>
                <input
                  id='delete-confirm'
                  type='text'
                  value={deleteConfirmationText}
                  onChange={(e) => setDeleteConfirmationText(e.target.value)}
                  placeholder='confirm'
                  className='w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
                  disabled={deletingKey === documentToDelete.key}
                />
              </div>

              <div className='flex gap-3 justify-end'>
                <Button variant='outline' onClick={cancelDelete} disabled={deletingKey === documentToDelete.key}>
                  Cancel
                </Button>
                <Button
                  variant='destructive'
                  onClick={deleteDocument}
                  disabled={deletingKey === documentToDelete.key || deleteConfirmationText !== 'confirm'}
                >
                  {deletingKey === documentToDelete.key ? (
                    <>
                      <div className='animate-spin rounded-full h-4 w-4 border-2 border-background border-t-transparent mr-2' />
                      Deleting...
                    </>
                  ) : (
                    'Delete'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

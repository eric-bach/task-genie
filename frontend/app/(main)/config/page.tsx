'use client';

import { useEffect, useState } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AREA_PATHS, BUSINESS_UNITS, SYSTEMS } from '@/lib/constants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Plus, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { PromptSuffixInfo } from '@/components/ui/prompt-suffix-info';

interface ConfigItem {
  adoKey: string;
  areaPath: string;
  businessUnit: string;
  system: string;
  prompt: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export default function ConfigPage() {
  const { user } = useAuthenticator((context) => [context.user]);
  const email = user?.signInDetails?.loginId || '';

  const [items, setItems] = useState<ConfigItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [prevTokens, setPrevTokens] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showSheet, setShowSheet] = useState(false);
  const [editing, setEditing] = useState<ConfigItem | null>(null);

  // Delete confirmation modal state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ConfigItem | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [areaPath, setAreaPath] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [system, setSystem] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const loadItems = async (token?: string, direction?: 'next' | 'prev') => {
    setIsLoading(true);
    try {
      const url = new URL('/api/config', window.location.origin);
      url.searchParams.set('pageSize', String(pageSize));
      if (token) url.searchParams.set('nextToken', token);
      const resp = await fetch(url.toString(), { method: 'GET' });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setItems(data.items || []);
      setNextToken(data.nextToken);
      if (direction === 'next') {
        setPrevTokens((prev) => [...prev, token || '']);
        setCurrentPage((p) => p + 1);
      } else if (direction === 'prev') {
        setCurrentPage((p) => Math.max(1, p - 1));
      } else {
        setCurrentPage(1);
        setPrevTokens([]);
      }
    } catch (e) {
      toast.error('Failed to load configuration', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setIsLoading(false);
    }
  };

  const goToNextPage = () => {
    if (nextToken) {
      loadItems(nextToken, 'next');
    }
  };

  const goToPreviousPage = () => {
    if (prevTokens.length > 1) {
      const tokens = [...prevTokens];
      tokens.pop(); // remove current
      const prevToken = tokens.pop();
      setPrevTokens(tokens);
      loadItems(prevToken, 'prev');
    } else {
      // Go back to first page
      setPrevTokens([]);
      loadItems(undefined);
    }
  };

  const changePageSize = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
    setPrevTokens([]);
    loadItems(undefined);
  };

  const openNew = () => {
    setEditing(null);
    setAreaPath('');
    setBusinessUnit('');
    setSystem('');
    setPrompt('');
    setShowSheet(true);
  };

  const openEdit = (item: ConfigItem) => {
    setEditing(item);
    setAreaPath(item.areaPath);
    setBusinessUnit(item.businessUnit);
    setSystem(item.system);
    setPrompt(item.prompt);
    setShowSheet(true);
  };

  const saveItem = async () => {
    if (!email) {
      toast.error('User email not found. Please sign in again.');
      return;
    }
    // In edit mode, only validate prompt since other fields are disabled
    if (editing) {
      if (!prompt) {
        toast.error('Please enter a prompt.');
        return;
      }
    } else {
      // In create mode, validate all fields
      if (!areaPath || !businessUnit || !system || !prompt) {
        toast.error('Please fill in all fields.');
        return;
      }
    }
    setSaving(true);
    try {
      const resp = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaPath, businessUnit, system, prompt, username: email }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setShowSheet(false);
      await loadItems();
      toast.success('Configuration saved');
    } catch (e) {
      toast.error('Failed to save configuration', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: ConfigItem) => {
    setItemToDelete(item);
    setShowDeleteConfirm(true);
    setDeleteConfirmationText('');
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setItemToDelete(null);
    setDeleteConfirmationText('');
  };

  const deleteItem = async () => {
    if (!itemToDelete) return;

    setIsDeleting(true);
    try {
      const url = new URL('/api/config', window.location.origin);
      url.searchParams.set('adoKey', itemToDelete.adoKey);
      const resp = await fetch(url.toString(), { method: 'DELETE' });
      if (!resp.ok) throw new Error(await resp.text());
      await loadItems();
      toast.success('Configuration deleted');
      setShowDeleteConfirm(false);
      setItemToDelete(null);
      setDeleteConfirmationText('');
    } catch (e) {
      toast.error('Failed to delete configuration', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setIsDeleting(false);
    }
  };

  // Initial load and when pageSize changes
  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  return (
    <div className='container mx-auto py-10 px-4 min-h-screen'>
      <div className='max-w-4xl xl:max-w-6xl mx-auto'>
        <h1 className='text-2xl font-bold mb-2'>Prompt Override Configuration</h1>
        <p className='text-md text-muted-foreground mb-8'>
          Use this page to configure prompt overrides for your ADO board.
        </p>

        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div>
                <CardTitle>Prompt Overrides</CardTitle>
                <CardDescription className='pt-1'>
                  Here you can manage and override the default task generation prompt with a custom one for your ADO
                  board.
                </CardDescription>
              </div>
              <div className='flex items-center gap-2'>
                <Button variant='outline' size='sm' onClick={() => loadItems()} disabled={isLoading}>
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
                <Button size='sm' onClick={openNew}>
                  <Plus className='h-4 w-4 mr-1' /> Override
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='whitespace-nowrap'>Area</TableHead>
                    <TableHead className='whitespace-nowrap'>Business Unit</TableHead>
                    <TableHead className='whitespace-nowrap'>System</TableHead>
                    <TableHead className='whitespace-nowrap'>Updated At</TableHead>
                    <TableHead className='whitespace-nowrap'>Updated By</TableHead>
                    <TableHead className='whitespace-nowrap'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className='text-center text-sm text-muted-foreground'>
                        No custom prompts found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((it) => (
                      <TableRow key={it.adoKey}>
                        <TableCell className='whitespace-nowrap'>{it.areaPath || '-'}</TableCell>
                        <TableCell className='whitespace-nowrap'>{it.businessUnit || '-'}</TableCell>
                        <TableCell className='whitespace-nowrap'>{it.system || '-'}</TableCell>
                        <TableCell className='whitespace-nowrap'>{it.updatedAt || '-'}</TableCell>
                        <TableCell className='whitespace-nowrap'>{it.updatedBy || '-'}</TableCell>
                        <TableCell className='whitespace-nowrap'>
                          <div className='flex items-center gap-2'>
                            <Button variant='outline' size='sm' onClick={() => openEdit(it)}>
                              <Pencil className='h-4 w-4 mr-1' /> Edit
                            </Button>
                            <Button variant='destructive' size='sm' onClick={() => confirmDelete(it)}>
                              <Trash2 className='h-4 w-4 mr-1' /> Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
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
                  disabled={currentPage === 1 || isLoading}
                >
                  Previous
                </Button>
                <span className='text-sm text-muted-foreground'>Page {currentPage}</span>
                <Button variant='outline' size='sm' onClick={goToNextPage} disabled={!nextToken || isLoading}>
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={showSheet} onOpenChange={setShowSheet}>
          <DialogContent className='sm:max-w-2xl max-h-[90vh] flex flex-col'>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Prompt Override' : 'New Prompt Override'}</DialogTitle>
              <DialogDescription>
                {editing ? 'Update the prompt' : 'Create a new prompt to override the default task generation prompt'}
              </DialogDescription>
            </DialogHeader>
            <div className='flex-1 overflow-y-auto mt-2 space-y-4 pr-2'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <div>
                  <Label htmlFor='areaPath' className='pb-2'>
                    Area Path
                  </Label>
                  <Select value={areaPath} onValueChange={(v) => setAreaPath(v)} disabled={!!editing}>
                    <SelectTrigger id='areaPath'>
                      <SelectValue placeholder='Select an area path' />
                    </SelectTrigger>
                    <SelectContent>
                      {AREA_PATHS.map((ap) => (
                        <SelectItem key={ap} value={ap}>
                          {ap}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor='businessUnit' className='pb-2'>
                    Business Unit
                  </Label>
                  <Select value={businessUnit} onValueChange={(v) => setBusinessUnit(v)} disabled={!!editing}>
                    <SelectTrigger id='businessUnit'>
                      <SelectValue placeholder='Select a business unit' />
                    </SelectTrigger>
                    <SelectContent>
                      {BUSINESS_UNITS.map((bu) => (
                        <SelectItem key={bu} value={bu}>
                          {bu}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor='system' className='pb-2'>
                    System
                  </Label>
                  <Select value={system} onValueChange={(v) => setSystem(v)} disabled={!!editing}>
                    <SelectTrigger id='system'>
                      <SelectValue placeholder='Select a system' />
                    </SelectTrigger>
                    <SelectContent>
                      {SYSTEMS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor='prompt' className='pb-2'>
                  Custom Prompt
                </Label>
                <Textarea
                  id='prompt'
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={20}
                  placeholder='Enter your task generation prompt...'
                />
                <PromptSuffixInfo className='mt-3' />
              </div>
            </div>
            <DialogFooter className='mt-6 flex-shrink-0'>
              <Button onClick={saveItem} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && itemToDelete && (
          <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
            <div className='bg-background rounded-lg p-6 max-w-md w-full mx-4 shadow-lg'>
              <div className='flex items-center gap-3 mb-4'>
                <AlertCircle className='h-6 w-6 text-destructive' />
                <h3 className='text-lg font-semibold'>Confirm Deletion</h3>
              </div>
              <p className='text-muted-foreground mb-4'>
                Are you sure you want to delete the prompt override for{' '}
                <span className='font-medium text-foreground'>
                  {itemToDelete.areaPath} / {itemToDelete.businessUnit} / {itemToDelete.system}
                </span>
                ? This action cannot be undone.
              </p>

              <div className='mb-6'>
                <label htmlFor='delete-confirm' className='block text-sm font-medium text-foreground mb-2'>
                  Type &quot;confirm&quot; to proceed with deletion:
                </label>
                <input
                  id='delete-confirm'
                  type='text'
                  value={deleteConfirmationText}
                  onChange={(e) => setDeleteConfirmationText(e.target.value)}
                  placeholder='confirm'
                  className='w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
                  disabled={isDeleting}
                />
              </div>

              <div className='flex gap-3 justify-end'>
                <Button variant='outline' onClick={cancelDelete} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button
                  variant='destructive'
                  onClick={deleteItem}
                  disabled={isDeleting || deleteConfirmationText !== 'confirm'}
                >
                  {isDeleting ? (
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

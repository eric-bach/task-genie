'use client';

import { useState } from 'react';
import { Info, ChevronDown, ChevronRight } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PromptSuffixInfoProps {
  className?: string;
}

export function PromptSuffixInfo({ className = '' }: PromptSuffixInfoProps) {
  const [showPromptSuffix, setShowPromptSuffix] = useState(false);

  return (
    <Alert className={`border-blue-200 bg-blue-50/50 ${className}`}>
      <Info className='h-4 w-4 text-blue-600' />
      <AlertDescription className='text-sm text-blue-800'>
        <div className='space-y-2'>
          <p>
            <strong>Note:</strong> Your custom prompt will also contain the following system instructions to ensure the
            AI agent returns results in the correct JSON format. You do not need to include references to the work item
            details in your prompt.
          </p>
          <button
            type='button'
            onClick={() => setShowPromptSuffix(!showPromptSuffix)}
            className='flex items-center text-xs text-blue-600 hover:text-blue-800 font-medium'
          >
            {showPromptSuffix ? <ChevronDown className='h-3 w-3 mr-1' /> : <ChevronRight className='h-3 w-3 mr-1' />}
            {showPromptSuffix ? 'Hide' : 'Show'} system instructions
          </button>
          {showPromptSuffix && (
            <div className='mt-2 p-3 bg-gray-50 rounded-md border border-gray-200'>
              <p className='text-xs text-gray-600 font-medium mb-2'>The following will be appended to your prompt:</p>
              <pre className='text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed'>
                {`**Context**
- Here is the work item:
  - Title: \${workItemTitle}
  - Description: \${workItemDescription}
  - Acceptance Criteria: \${workItemAcceptanceCriteria}

- Here are the tasks that have already been created for this work item (if any):
  \${tasks}

- Here are the images referenced (if any were included):
  \${images}
      
- Here is additional context that you should consider (if any were provided):
  \${knowledgeBaseContent}

**Output Rules**
- ONLY return a JSON object with the following structure:
  - "tasks": array of task objects, each with:
    - "title": string (task title, prefixed with order, e.g., "1. Task Title")
    - "description": string (detailed task description with HTML formatting)
- DO NOT output any text outside of the JSON object.`}
              </pre>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

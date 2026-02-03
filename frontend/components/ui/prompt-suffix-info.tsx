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
            <strong>Note:</strong> Your prompt override will also contain the following context to ensure the AI agent
            evaluates the user story content and returns results in the correct JSON format. You do not need to
            duplicate this in the prompt override.
          </p>
          <button
            type='button'
            onClick={() => setShowPromptSuffix(!showPromptSuffix)}
            className='flex items-center text-xs text-blue-600 hover:text-blue-800 font-medium'
          >
            {showPromptSuffix ? <ChevronDown className='h-3 w-3 mr-1' /> : <ChevronRight className='h-3 w-3 mr-1' />}
            {showPromptSuffix ? 'Hide' : 'Show'} context prompt
          </button>
          {showPromptSuffix && (
            <div className='mt-2 p-3 bg-gray-50 rounded-md border border-gray-200'>
              <p className='text-xs text-gray-600 font-medium mb-2'>
                The following will be provided in addition to your prompt:
              </p>
              <pre className='text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed'>
                {`**Context**
- Work item:
Use this information to understand the scope and expectation to generate relevant tasks.
  - Title: \${workItemTitle}
  - Description: \${workItemDescription}
  - Acceptance Criteria: \${workItemAcceptanceCriteria}

- Existing tasks (if any):
Current tasks already created for this user story. Avoid duplicating these; generate only missing or supplementary tasks for completeness.
  \${tasks}

- Images (if any):
Visual aids or references that provide additional context for task generation.
  \${images}
      
- Additional contextual knowledge (if any):
Extra domain knowledge, system information, or reference material to guide more context-aware and accurate task generation.
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

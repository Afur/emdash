import { useState } from 'react';
import { useToast } from './use-toast';
import githubLogo from '../../assets/images/github.png';

type CreatePROptions = {
  workspacePath: string;
  commitMessage?: string;
  createBranchIfOnDefault?: boolean;
  branchPrefix?: string;
  prOptions?: {
    title?: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    web?: boolean;
    fill?: boolean;
  };
  onSuccess?: () => Promise<void> | void;
};

export function useCreatePR() {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);

  const createPR = async (opts: CreatePROptions) => {
    const {
      workspacePath,
      commitMessage = 'chore: apply workspace changes',
      createBranchIfOnDefault = true,
      branchPrefix = 'orch',
      prOptions,
      onSuccess,
    } = opts;

    setIsCreating(true);
    try {
      const commitRes = await window.electronAPI.gitCommitAndPush({
        workspacePath,
        commitMessage,
        createBranchIfOnDefault,
        branchPrefix,
      });

      if (!commitRes?.success) {
        toast({
          title: 'Commit/Push Failed',
          description: commitRes?.error || 'Unable to push changes.',
          variant: 'destructive',
        });
        return { success: false, error: commitRes?.error || 'Commit/push failed' };
      }

      const res = await window.electronAPI.createPullRequest({
        workspacePath,
        fill: true,
        ...(prOptions || {}),
      });

      if (res?.success) {
        toast({
          title: (
            <span className="inline-flex items-center gap-2">
              <img src={githubLogo} alt="GitHub" className="h-5 w-5 rounded-sm object-contain" />
              Pull Request Created
            </span>
          ),
          description: res.url || 'PR created successfully.',
        });
        try {
          await onSuccess?.();
        } catch {
          // ignore onSuccess errors
        }
      } else {
        const details = res?.output && typeof res.output === 'string' ? `\n\nDetails:\n${res.output}` : '';
        toast({
          title: (
            <span className="inline-flex items-center gap-2">
              <img src={githubLogo} alt="GitHub" className="h-5 w-5 rounded-sm object-contain" />
              Failed to Create PR
            </span>
          ),
          description: (res?.error || 'Unknown error') + details,
          variant: 'destructive',
        });
      }

      return res;
    } finally {
      setIsCreating(false);
    }
  };

  return { isCreating, createPR };
}

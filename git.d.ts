// Type definitions for git API
// Project: todolist-samui
// Definitions by: jajahhhhhhh

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
}

export interface GitStatus {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

export interface GitAPI {
  getStatus(): Promise<GitStatus>;
  getBranches(): Promise<GitBranch[]>;
  getCommits(limit?: number): Promise<GitCommit[]>;
  checkoutBranch(branchName: string): Promise<void>;
  createBranch(branchName: string): Promise<void>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
}

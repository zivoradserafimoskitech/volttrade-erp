/// <reference types="npm:@types/react@18.3.1" />
import type * as React from 'npm:react@18.3.1'
import { template as invoiceNotice } from './invoice-notice.tsx'

export interface TemplateEntry {
  // deno-lint-ignore no-explicit-any
  component: React.ComponentType<any>
  // deno-lint-ignore no-explicit-any
  subject: string | ((data: any) => string)
  displayName?: string
  // deno-lint-ignore no-explicit-any
  previewData?: Record<string, any>
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'invoice-notice': invoiceNotice,
}

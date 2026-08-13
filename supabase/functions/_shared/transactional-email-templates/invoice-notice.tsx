/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import { Shell, Signature, button, h1, main, text } from '../email-templates/brand.tsx'
import type { TemplateEntry } from './registry.ts'

type Kind = 'invoice' | 'reminder' | 'dunning'
type Lang = 'mk' | 'sq' | 'en'

export interface InvoiceNoticeProps {
  kind?: Kind
  lang?: Lang
  companyName?: string
  invoiceNumber?: string
  amount?: string
  dueDate?: string
  daysOverdue?: number
  dunningLevel?: number
  portalUrl?: string
}

const COPY: Record<Lang, Record<Kind, (p: Required<Pick<InvoiceNoticeProps,
  'invoiceNumber' | 'amount' | 'dueDate' | 'daysOverdue' | 'dunningLevel'>>) => { title: string; body: string }> & { cta: string; hello: (n: string) => string }> = {
  mk: {
    hello: (n) => `Почитувани ${n},`,
    cta: 'Отвори ја фактурата',
    invoice: (p) => ({
      title: `Нова фактура ${p.invoiceNumber}`,
      body: `Вашата фактура ${p.invoiceNumber} на износ ${p.amount} е издадена. Рок на плаќање: ${p.dueDate}. Фактурата можете да ја преземете во делот „Фактури“ во порталот.`,
    }),
    reminder: (p) => ({
      title: `Потсетување за плаќање — ${p.invoiceNumber}`,
      body: `Ве потсетуваме дека фактурата ${p.invoiceNumber} на износ ${p.amount} со рок ${p.dueDate} сè уште не е евидентирана како платена. Ако веќе сте платиле, ве молиме занемарете го ова известување.`,
    }),
    dunning: (p) => ({
      title: `Опомена (${p.dunningLevel}. степен) — ${p.invoiceNumber}`,
      body: `Фактурата ${p.invoiceNumber} на износ ${p.amount} е доспеана на ${p.dueDate} и е неплатена ${p.daysOverdue} дена. Ве молиме да го измирите долгот во рок од 8 дена. Во спротивно ќе се пресметува законска затезна камата и постапката ќе биде препратена на наплата.`,
    }),
  },
  sq: {
    hello: (n) => `Të nderuar ${n},`,
    cta: 'Hap faturën',
    invoice: (p) => ({
      title: `Faturë e re ${p.invoiceNumber}`,
      body: `Fatura juaj ${p.invoiceNumber} në shumën ${p.amount} është lëshuar. Afati i pagesës: ${p.dueDate}. Faturën mund ta shkarkoni te seksioni “Faturat” në portal.`,
    }),
    reminder: (p) => ({
      title: `Kujtesë për pagesë — ${p.invoiceNumber}`,
      body: `Ju kujtojmë se fatura ${p.invoiceNumber} në shumën ${p.amount} me afat ${p.dueDate} ende nuk figuron e paguar. Nëse e keni paguar, ju lutemi shpërfilleni këtë njoftim.`,
    }),
    dunning: (p) => ({
      title: `Vërejtje (shkalla ${p.dunningLevel}) — ${p.invoiceNumber}`,
      body: `Fatura ${p.invoiceNumber} në shumën ${p.amount} ka skaduar më ${p.dueDate} dhe është e papaguar prej ${p.daysOverdue} ditësh. Ju lutemi ta shlyeni brenda 8 ditësh, përndryshe llogaritet kamatë ligjore dhe procedura kalon në arkëtim.`,
    }),
  },
  en: {
    hello: (n) => `Dear ${n},`,
    cta: 'View invoice',
    invoice: (p) => ({
      title: `New invoice ${p.invoiceNumber}`,
      body: `Your invoice ${p.invoiceNumber} for ${p.amount} has been issued. Due date: ${p.dueDate}. You can download it from the Invoices section of the portal.`,
    }),
    reminder: (p) => ({
      title: `Payment reminder — ${p.invoiceNumber}`,
      body: `This is a reminder that invoice ${p.invoiceNumber} for ${p.amount}, due ${p.dueDate}, is still unpaid. Please ignore this notice if payment has already been made.`,
    }),
    dunning: (p) => ({
      title: `Formal notice (level ${p.dunningLevel}) — ${p.invoiceNumber}`,
      body: `Invoice ${p.invoiceNumber} for ${p.amount} was due on ${p.dueDate} and is ${p.daysOverdue} days overdue. Please settle within 8 days; otherwise statutory late interest applies and the debt is passed to collection.`,
    }),
  },
}

export const resolveCopy = (p: InvoiceNoticeProps) => {
  const lang: Lang = p.lang ?? 'en'
  const kind: Kind = p.kind ?? 'invoice'
  return COPY[lang][kind]({
    invoiceNumber: p.invoiceNumber ?? '—',
    amount: p.amount ?? '—',
    dueDate: p.dueDate ?? '—',
    daysOverdue: p.daysOverdue ?? 0,
    dunningLevel: p.dunningLevel ?? 1,
  })
}

const InvoiceNoticeEmail = (props: InvoiceNoticeProps) => {
  const lang: Lang = props.lang ?? 'en'
  const copy = resolveCopy(props)
  const portalUrl = props.portalUrl ?? 'https://volttrade.app/portal/invoices'
  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{copy.title}</Preview>
      <Body style={main}>
        <Shell>
          <Heading style={h1}>{copy.title}</Heading>
          <Text style={text}>{COPY[lang].hello(props.companyName ?? '')}</Text>
          <Text style={text}>{copy.body}</Text>
          <Section style={{ margin: '0 0 24px' }}>
            <Button href={portalUrl} style={button}>{COPY[lang].cta}</Button>
          </Section>
          <Signature siteName="VoltTrade" />
        </Shell>
      </Body>
    </Html>
  )
}

export const template = {
  component: InvoiceNoticeEmail,
  subject: (data: InvoiceNoticeProps) => resolveCopy(data ?? {}).title,
  displayName: 'Invoice notice',
  previewData: {
    kind: 'invoice',
    lang: 'mk',
    companyName: 'Пример ДООЕЛ',
    invoiceNumber: 'INV-2026-000123',
    amount: '12.345,67 EUR',
    dueDate: '31.08.2026',
  },
} satisfies TemplateEntry

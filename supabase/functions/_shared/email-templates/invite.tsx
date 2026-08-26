/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Body, Button, Head, Heading, Html, Link, Preview, Text } from 'npm:@react-email/components@0.0.22'
import { Shell, Signature, button, footer, h1, link, main, text } from './brand.tsx'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Shell>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Accept the invitation below to set your password and get access.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept invitation
        </Button>
        <Text style={footer}>
          This invitation link expires in 24 hours (1440 minutes). If you weren't expecting this invitation, you can safely ignore this email.
        </Text>
        <Signature siteName={siteName} />
      </Shell>
    </Body>
  </Html>
)

export default InviteEmail

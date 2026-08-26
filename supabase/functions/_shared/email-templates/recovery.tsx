/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Body, Button, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import { Shell, Signature, button, footer, h1, main, text } from './brand.tsx'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={main}>
      <Shell>
        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          We received a request to reset your password for {siteName}. Choose a new one below.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Reset password
        </Button>
        <Text style={footer}>
          This link expires in 24 hours (1440 minutes). If you didn't request a password reset, you can safely ignore this email — your password won't change.
        </Text>
        <Signature siteName={siteName} />
      </Shell>
    </Body>
  </Html>
)

export default RecoveryEmail

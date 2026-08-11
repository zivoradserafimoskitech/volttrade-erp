/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Body, Button, Head, Heading, Html, Link, Preview, Text } from 'npm:@react-email/components@0.0.22'
import { Shell, Signature, button, footer, h1, link, main, text } from './brand.tsx'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Shell>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Confirm{' '}
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>{' '}
          to activate your account.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Verify email
        </Button>
        <Text style={footer}>If you didn't create an account, you can safely ignore this email.</Text>
        <Signature siteName={siteName} />
      </Shell>
    </Body>
  </Html>
)

export default SignupEmail

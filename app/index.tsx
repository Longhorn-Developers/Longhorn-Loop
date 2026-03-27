import React, { useState } from 'react';
import AccountVerification from './AccountVerification';
import CreateAccount from './CreateAccount';
import InterestSelection from './InterestSelection';
import TermsAndConditions from './TermsAndConditions';

// Onboarding order:
// 0 → AccountVerification
// 1 → CreateAccount
// 2 → InterestSelection
// 3 → TermsAndConditions

export default function Index() {
  const [step, setStep] = useState(0);

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));

  if (step === 0) return <AccountVerification onVerify={next} onBack={back} onResend={() => {}} />;
  if (step === 1) return <CreateAccount onNext={next} onBack={back} />;
  if (step === 2) return <InterestSelection onNext={next} onBack={back} />;
  if (step === 3) return <TermsAndConditions onNext={next} onBack={back} />;

  // TODO: add future onboarding pages here as step === 4, 5, etc.
  return null;
}
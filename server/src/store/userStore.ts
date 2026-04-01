type UserRecord = {
  email: string;        
  agreed_responsible_use: boolean;
  agreed_visibility_acknowledgment: boolean;
  agreed_community_guidelines: boolean;         
  notifications_enabled : boolean;        
  terms_accepted_at?: string;
  onboarding_completed: boolean;
};

const userStore = new Map<string, UserRecord>();

export function getUser(email: string): UserRecord | undefined {
  return userStore.get(email);
}

export function saveUser(email: string, data: Partial<UserRecord>): UserRecord {
  const existing = userStore.get(email) || {
    email,
    agreed_responsible_use: false,
    agreed_visibility_acknowledgment: false,
    agreed_community_guidelines: false,
    notifications_enabled: false,
    onboarding_completed: false,
  };

  const updated = { ...existing, ...data };
  userStore.set(email, updated);
  return updated;
}
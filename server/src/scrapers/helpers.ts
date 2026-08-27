function inferVenueType(location: string | null | undefined, address: string | null | undefined): 'in_person' | 'online' {
  const text = `${location ?? ''} ${address ?? ''}`.toLowerCase();

  const onlineIndicators = [
    'online',
    'virtual',
    'zoom',
    'zoom webinar'
  ];

  return onlineIndicators.some((indicator) => text.includes(indicator))
    ? 'online'
    : 'in_person';
}
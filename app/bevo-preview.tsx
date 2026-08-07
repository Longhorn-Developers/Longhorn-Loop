// TEMP preview route for eyeballing BevoAvatar. Open /bevo-preview.
// Delete this file when you're done reviewing.
import BevoAvatar from '@/app/components/avatar/BevoAvatar';
import { BEVO_HATS, BEVO_PALETTES, BEVO_PATTERNS } from '@/shared/avatar';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

export default function BevoPreview() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F9F8F5' }} contentContainerStyle={{ padding: 12 }}>
      <Text style={{ fontWeight: '700', marginBottom: 4 }}>Palettes</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {BEVO_PALETTES.map((p) => (
          <View key={p} style={{ alignItems: 'center', margin: 4 }}>
            <BevoAvatar config={{ palette: p }} height={90} />
            <Text style={{ fontSize: 10 }}>{p}</Text>
          </View>
        ))}
      </View>

      <Text style={{ fontWeight: '700', marginVertical: 4 }}>Patterns (orange)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {BEVO_PATTERNS.map((pat) => (
          <View key={pat} style={{ alignItems: 'center', margin: 4 }}>
            <BevoAvatar config={{ palette: 'orange', pattern: pat }} height={90} />
            <Text style={{ fontSize: 10 }}>{pat}</Text>
          </View>
        ))}
      </View>

      <Text style={{ fontWeight: '700', marginVertical: 4 }}>Hats (cyan)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {BEVO_HATS.map((hat) => (
          <View key={hat} style={{ alignItems: 'center', margin: 4 }}>
            <BevoAvatar config={{ palette: 'cyan', hat }} height={90} />
            <Text style={{ fontSize: 10 }}>{hat}</Text>
          </View>
        ))}
      </View>

      <Text style={{ fontWeight: '700', marginVertical: 4 }}>Combined</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <BevoAvatar config={{ palette: 'pink', pattern: 'heart', hat: 'topHat' }} height={110} />
        <BevoAvatar config={{ palette: 'brown', pattern: 'stars', hat: 'cap' }} height={110} />
        <BevoAvatar config={{ palette: 'grey', pattern: 'diamonds', hat: 'headphones' }} height={110} />
      </View>
    </ScrollView>
  );
}

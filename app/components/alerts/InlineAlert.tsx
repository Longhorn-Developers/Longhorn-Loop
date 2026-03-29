import React from 'react';
import { View, Text } from 'react-native';

interface InlineAlertProps {
  message: string;
  textColor?: string;
  borderColor?: string;
  backgroundColor?: string;
}

export default function InlineAlert({
  message,
  textColor='hsla(0, 100%, 41%, 1)',
  borderColor='hsla(0, 100%, 41%, 1)',
  backgroundColor='hsla(351, 76%, 95%, 1)',
}: InlineAlertProps) {
  return (
    <View 
      className='flex-row items-center h-[40px] p-3 rounded-[4px]'
      style={{
        backgroundColor,
        borderColor,
        borderWidth: 1,
      }}
    >
      <Text
        className='text-sm font-medium pb-[1px]'
        style={{ color: textColor }}>
        {message}
      </Text>
    </View>
  );
}
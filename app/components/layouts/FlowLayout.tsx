import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { ArrowLeftIcon } from 'phosphor-react-native';

interface FlowLayoutProps {
  title?: string;
  subTitle?: string;
  showProgressBar?: boolean; // TODO
  progressBarPercentage?: number; // TODO
  children?: React.ReactNode;
  onBackPress?: () => void;
}

export default function FlowLayout({
  title, 
  subTitle, 
  children,
  onBackPress=()=>{}, 
}: FlowLayoutProps) {
  return (
    <View 
      className='min-h-screen pt-[70px] px-5 bg-lhlBackgroundColor'
    >
      {/* Back Icon */}
      <Pressable onPress={onBackPress}>
        <ArrowLeftIcon size={24} />
      </Pressable>

      {/* Progress Bar */}
      {/* TODO */}

      {/* Title */}
      {title && <Text
        className='mt-[42px] font-semibold text-[32px]'
      >{title}</Text>}

      {/* Sub Title */}
      {subTitle && <Text
        className='font-semibold text-base'
      >{subTitle}</Text>}

      {/* Body content */}
      <View>
        {children}
      </View>
    </View>
  );
}
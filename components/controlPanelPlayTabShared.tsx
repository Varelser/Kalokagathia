import React from 'react';

export const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
    {icon} {children}
  </h3>
);

export const TAB_SHORT_LABELS: Record<string, string> = {
  global: 'Main',
  layer1: 'L1',
  layer2: 'L2',
  layer3: 'L3',
  ambient: 'Amb',
  audio: 'FX',
};


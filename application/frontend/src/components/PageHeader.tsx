import React from 'react';

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </>
  );
}

import React from 'react';

type PrStatusSkeletonProps = {
  className?: string;
  widthClass?: string;
  heightClass?: string;
  ariaLabel?: string;
};

export const PrStatusSkeleton: React.FC<PrStatusSkeletonProps> = ({
  className = '',
  widthClass = 'w-20',
  heightClass = 'h-5',
  ariaLabel = 'Loading pull request status',
}) => {
  return (
    <span
      className={`inline-block align-middle ${heightClass} ${widthClass} animate-pulse rounded border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800 ${className}`}
      aria-label={ariaLabel}
    />
  );
};

export default PrStatusSkeleton;

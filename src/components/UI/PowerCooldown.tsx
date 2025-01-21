import React from 'react';

interface PowerCooldownProps {
    isOnCooldown: boolean;
    cooldownProgress: number; // 0 to 1
    children?: React.ReactNode;
}

const PowerCooldown: React.FC<PowerCooldownProps> = ({ 
    isOnCooldown, 
    cooldownProgress,
    children
}) => {
    // Calculate the circumference of the circle
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const dashArray = `${circumference * cooldownProgress} ${circumference}`;

    return (
        <div className="relative w-[60px] h-[60px]">
            {/* Background circle */}
            <svg 
                className="absolute inset-0"
                viewBox="0 0 36 36"
                style={{ transform: 'rotate(-90deg)' }}
            >
                {/* Static background circle */}
                <circle
                    cx="18"
                    cy="18"
                    r="16"
                    fill="none"
                    className={isOnCooldown ? 'stroke-gray-300' : 'stroke-green-500'}
                    strokeWidth="3"
                />
                {/* Progress circle */}
                {isOnCooldown && (
                    <circle
                        cx="18"
                        cy="18"
                        r="16"
                        fill="none"
                        className="stroke-green-500"
                        strokeWidth="3"
                        style={{
                            strokeDasharray: dashArray,
                            transition: "stroke-dasharray 150ms linear"
                        }}
                    />
                )}
            </svg>
            {/* Icon container */}
            <div className="absolute inset-0 flex items-center justify-center text-white">
                {children}
            </div>
        </div>
    );
};

export default PowerCooldown; 
import React from 'react';

interface PowerCooldownProps {
    isOnCooldown: boolean;
    cooldownProgress: number; // 0 to 1
}

const PowerCooldown: React.FC<PowerCooldownProps> = ({ 
    isOnCooldown, 
    cooldownProgress
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

            {/* Hydrant Icon */}
            <svg
                className={`absolute inset-0 w-8 h-8 m-auto ${isOnCooldown ? 'opacity-50' : 'opacity-100'} transition-opacity duration-200`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
            >
                {/* Main body */}
                <path
                    className="text-red-500"
                    fill="currentColor"
                    d="M8 6h8v12H8z"
                />
                {/* Top cap */}
                <path
                    className="text-red-500"
                    fill="currentColor"
                    d="M7 4h10v2H7z"
                />
                {/* Bottom base */}
                <path
                    className="text-red-500"
                    fill="currentColor"
                    d="M6 18h12v2H6z"
                />
                {/* Side nozzles */}
                <path
                    className="text-red-500"
                    fill="currentColor"
                    d="M4 10h4v1H4zM16 10h4v1h-4z"
                />
                {/* Center bolt/cap details */}
                <circle
                    className="text-red-700"
                    fill="currentColor"
                    cx="12"
                    cy="12"
                    r="1.5"
                />
            </svg>
        </div>
    );
};

export default PowerCooldown; 
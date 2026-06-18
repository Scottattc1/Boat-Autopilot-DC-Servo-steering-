import React, { useState } from 'react';
import { 
  Sliders, Cpu, Download, Copy, Check, Circle, ShieldAlert,
  ArrowRight, ToggleLeft, ToggleRight, Zap
} from 'lucide-react';

interface CalibrationRoomProps {
  calibGainKp: number;
  setCalibGainKp: (val: number) => void;
  calibDeadband: number;
  setCalibDeadband: (val: number) => void;
  calibMinPwm: number;
  setCalibMinPwm: (val: number) => void;
  calibMaxPwm: number;
  setCalibMaxPwm: (val: number) => void;
  calibMaxTime: number;
  setCalibMaxTime: (val: number) => void;
  hBridgePinA: number;
  setHBridgePinA: (val: number) => void;
  hBridgePinB: number;
  setHBridgePinB: (val: number) => void;
  hBridgePinPwm: number;
  setHBridgePinPwm: (val: number) => void;
  downloadCalibrationHeader: () => void;
}

export default function CalibrationRoom({
  calibGainKp, setCalibGainKp,
  calibDeadband, setCalibDeadband,
  calibMinPwm, setCalibMinPwm,
  calibMaxPwm, setCalibMaxPwm,
  calibMaxTime, setCalibMaxTime,
  hBridgePinA, setHBridgePinA,
  hBridgePinB, setHBridgePinB,
  hBridgePinPwm, setHBridgePinPwm,
  downloadCalibrationHeader
}: CalibrationRoomProps) {
  
  // Playground Test Slider
  const [testHeadingError, setTestHeadingError] = useState<number>(8.5);
  const [copiedText, setCopiedText] = useState<boolean>(false);

  // Calculate live Simulated Pin values
  const absError = Math.abs(testHeadingError);
  const isWithinDeadband = absError < calibDeadband;
  
  // Speed compute
  let simulatedPwm = 0;
  let simulatedDirection = 'IDLE'; // 'PORT', 'STARBOARD', 'IDLE'
  let pinAState = 'LOW';
  let pinBState = 'LOW';

  if (!isWithinDeadband) {
    const rawPwm = calibMinPwm + (absError * calibGainKp);
    simulatedPwm = Math.min(calibMaxPwm, Math.max(calibMinPwm, Math.round(rawPwm)));
    if (testHeadingError < 0) {
      simulatedDirection = 'PORT (LEFT)';
      pinAState = 'HIGH';
      pinBState = 'LOW';
    } else {
      simulatedDirection = 'STARBOARD (RIGHT)';
      pinAState = 'LOW';
      pinBState = 'HIGH';
    }
  }

  const pwmPercentage = Math.round((simulatedPwm / 255) * 100);

  // Generate code block
  const generatedCodeString = `#ifndef ACTUATOR_CALIBRATION_H
#define ACTUATOR_CALIBRATION_H

// Core Open-Loop Steering Calibrations
#define STEERING_GAIN_KP             ${calibGainKp.toFixed(2)}
#define DEADBAND_DEGREES             ${calibDeadband.toFixed(2)}
#define MIN_DRIVE_PWM                ${calibMinPwm}
#define MAX_DRIVE_PWM                ${calibMaxPwm}
#define MAX_SINGLE_DIR_TRAVEL_MS     ${calibMaxTime}

// ESP8266 GPIO Actuation Pin mapping
#define PIN_MOTOR_PWM                ${hBridgePinPwm}  // Speed / Speed controller PWM
#define PIN_MOTOR_DIR_A              ${hBridgePinA}  // Phase A Left drive
#define PIN_MOTOR_DIR_B              ${hBridgePinB}  // Phase B Right drive
#define PIN_STATUS_LED               16  // Status LED pin (D0)

#endif`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedCodeString);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full flex-1">
      
      {/* LEFT COLUMN: PARAMETER ADJUSTMENTS & PINS (7 COLS) */}
      <div className="lg:col-span-7 flex flex-col gap-6">
        
        {/* HEADING ACCENT HEADER */}
        <div className="bg-zinc-900/45 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
          <div className="absolute right-0 top-0 w-48 h-48 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"></div>
          <h2 className="text-sm font-black font-mono tracking-wider text-cyan-400 uppercase flex items-center gap-2">
            <Sliders className="h-4 w-4 animate-spin-slow text-cyan-400" />
            Vessel Open-Loop Steering Calibration
          </h2>
          <p className="text-zinc-400 text-xs mt-2.5 font-sans leading-relaxed">
            Since your vessel uses standard physical DC electric motors on the rudder linkage without encoder or potentiometer feedback, steering adjustments must be executed via open-loop timed PWM bursts. Adjust physical thresholds and pins here.
          </p>
        </div>

        {/* CALIBRATION CONTROL VARIABLES CARD */}
        <div className="bg-zinc-900/45 border border-zinc-800 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
          <h3 className="text-xs font-bold font-mono text-zinc-300 pb-2.5 border-b border-zinc-800 uppercase tracking-wider flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-cyan-400" />
            Calibration Factors
          </h3>

          {/* 1. KP STEERING GAIN */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-200">Proportional Gain (Kp)</span>
                <span className="text-[10px] text-zinc-500 font-mono">Increments PWM offset per degree of error</span>
              </div>
              <strong className="text-cyan-400 text-sm font-mono bg-zinc-950 px-2.5 py-0.5 rounded border border-zinc-800">
                {calibGainKp.toFixed(1)}
              </strong>
            </div>
            <input
              type="range"
              min="1.0"
              max="40.0"
              step="0.5"
              value={calibGainKp}
              onChange={(e) => setCalibGainKp(parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
              <span>1.0 (Gentle response)</span>
              <span>40.0 (Snappy response)</span>
            </div>
          </div>

          {/* 2. ERROR DEADBAND */}
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-200">Steering Deadband Threshold</span>
                <span className="text-[10px] text-zinc-500 font-mono">Ignore bearing errors below this to prevent gear chatter</span>
              </div>
              <strong className="text-amber-400 text-sm font-mono bg-zinc-950 px-2.5 py-0.5 rounded border border-zinc-800">
                ± {calibDeadband.toFixed(1)}°
              </strong>
            </div>
            <input
              type="range"
              min="0.2"
              max="8.0"
              step="0.1"
              value={calibDeadband}
              onChange={(e) => setCalibDeadband(parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
              <span>0.2° (Sensitive, high wear)</span>
              <span>8.0° (Sluggish, saving juice)</span>
            </div>
          </div>

          {/* 3. MIN PWM */}
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-200">Actuator Min PWM (Torque Floor)</span>
                <span className="text-[10px] text-zinc-500 font-mono">Minimal speed value to overcome static mechanical friction</span>
              </div>
              <strong className="text-zinc-100 text-sm font-mono bg-zinc-950 px-2.5 py-0.5 rounded border border-zinc-800">
                {calibMinPwm} / 255
              </strong>
            </div>
            <input
              type="range"
              min="0"
              max="150"
              step="5"
              value={calibMinPwm}
              onChange={(e) => setCalibMinPwm(parseInt(e.target.value) || 0)}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
            />
            <div className="flex justify-between text-[9px] text-zinc-650 font-mono">
              <span>0% PWM</span>
              <span>58% PWM (Min torque trigger)</span>
            </div>
          </div>

          {/* 4. MAX PWM */}
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-200">Actuator Max PWM (Speed Limit)</span>
                <span className="text-[10px] text-zinc-500 font-mono">Limits top terminal voltage to protect motorized gears</span>
              </div>
              <strong className="text-zinc-100 text-sm font-mono bg-zinc-950 px-2.5 py-0.5 rounded border border-zinc-800">
                {calibMaxPwm} / 255
              </strong>
            </div>
            <input
              type="range"
              min="120"
              max="255"
              step="5"
              value={calibMaxPwm}
              onChange={(e) => setCalibMaxPwm(parseInt(e.target.value) || 255)}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
            />
            <div className="flex justify-between text-[9px] text-zinc-650 font-mono">
              <span>47% limit</span>
              <span>100% full speed cap</span>
            </div>
          </div>

          {/* 5. TRAVEL TIME LIMIT */}
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-200">Continuous Duty Travel Stop Timer</span>
                <span className="text-[10px] text-zinc-500 font-mono">De-energizes motor if driven in one direction past this limit</span>
              </div>
              <strong className="text-rose-400 text-sm font-mono bg-zinc-950 px-2.5 py-0.5 rounded border border-zinc-800">
                {(calibMaxTime / 1000).toFixed(1)} Sec
              </strong>
            </div>
            <input
              type="range"
              min="1000"
              max="8000"
              step="250"
              value={calibMaxTime}
              onChange={(e) => setCalibMaxTime(parseInt(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
            />
            <div className="flex justify-between text-[9px] text-zinc-650 font-mono">
              <span>1.0s (Shorter safety lock)</span>
              <span>8.0s (Long safety lock)</span>
            </div>
          </div>

        </div>

        {/* H-BRIDGE EXP8266 GPIO PIN ALLOCATIONS */}
        <div className="bg-zinc-900/45 border border-zinc-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
          <h3 className="text-xs font-bold font-mono text-zinc-300 pb-2.5 border-b border-zinc-800 uppercase tracking-wider flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-cyan-400" />
            H-Bridge Pins Mapping
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            <div className="bg-zinc-950/80 p-3 rounded-xl border border-zinc-850 flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">PWM Speed Pin (Enable)</span>
              <div className="flex items-center justify-between">
                <strong className="text-xs text-white">GPIO {hBridgePinPwm} (D1)</strong>
                <select
                  value={hBridgePinPwm}
                  onChange={(e) => setHBridgePinPwm(parseInt(e.target.value))}
                  className="bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-300 rounded px-1.5 py-0.5 outline-none focus:border-cyan-500"
                >
                  <option value={5}>GPIO 5 (D1)</option>
                  <option value={12}>GPIO 12 (D6)</option>
                  <option value={14}>GPIO 14 (D5)</option>
                </select>
              </div>
            </div>

            <div className="bg-zinc-950/80 p-3 rounded-xl border border-zinc-850 flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">DIR Phase A (Port Drive)</span>
              <div className="flex items-center justify-between">
                <strong className="text-xs text-white">GPIO {hBridgePinA} (D2)</strong>
                <select
                  value={hBridgePinA}
                  onChange={(e) => setHBridgePinA(parseInt(e.target.value))}
                  className="bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-300 rounded px-1.5 py-0.5 outline-none focus:border-cyan-500"
                >
                  <option value={4}>GPIO 4 (D2)</option>
                  <option value={13}>GPIO 13 (D7)</option>
                  <option value={2}>GPIO 2 (D4)</option>
                </select>
              </div>
            </div>

            <div className="bg-zinc-950/80 p-3 rounded-xl border border-zinc-850 flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">DIR Phase B (Stb Drive)</span>
              <div className="flex items-center justify-between">
                <strong className="text-xs text-white">GPIO {hBridgePinB} (D3)</strong>
                <select
                  value={hBridgePinB}
                  onChange={(e) => setHBridgePinB(parseInt(e.target.value))}
                  className="bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-300 rounded px-1.5 py-0.5 outline-none focus:border-cyan-500"
                >
                  <option value={0}>GPIO 0 (D3)</option>
                  <option value={15}>GPIO 15 (D8)</option>
                  <option value={10}>GPIO 10</option>
                </select>
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* RIGHT COLUMN: PLAYGROUND SIMULATOR & TELEMETRY (5 COLS) */}
      <div className="lg:col-span-5 flex flex-col gap-6">
        
        {/* INTERACTIVE PLAYGROUND CARD */}
        <div className="bg-zinc-900/45 border border-zinc-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
          <div className="flex justify-between items-center pb-2.5 border-b border-zinc-800">
            <h3 className="text-xs font-bold font-mono text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-cyan-400 animate-pulse" />
              Open-Loop Actuator Preview
            </h3>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-mono font-bold px-2 py-0.5 rounded border border-emerald-500/15">
              SIMULATED TELEMETRY
            </span>
          </div>

          <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-850 space-y-3">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-zinc-400 uppercase">Simulated Heading Error:</span>
              <strong className={testHeadingError < 0 ? "text-cyan-400" : "text-amber-400"}>
                {testHeadingError < 0 ? "← PORT" : "STARBOARD →"} {testHeadingError.toFixed(1)}°
              </strong>
            </div>
            <input
              type="range"
              min="-35"
              max="35"
              step="0.5"
              value={testHeadingError}
              onChange={(e) => setTestHeadingError(parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[8px] text-zinc-600 font-mono leading-none">
              <span>35° Port Error</span>
              <span className="text-zinc-500">Center (0°)</span>
              <span>35° Stb Error</span>
            </div>
          </div>

          {/* DYNAMIC PIN AND STATS GRAPH DISPLAY */}
          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-850 font-mono space-y-4">
            
            {/* POWER/SPEED BAR */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-zinc-500 uppercase font-black uppercase">Steering Motor Output PWM:</span>
                <span className="text-zinc-300 font-bold">{simulatedPwm} / 255 ({pwmPercentage}%)</span>
              </div>
              <div className="w-full h-2.5 bg-zinc-900 rounded overflow-hidden flex border border-zinc-800">
                <div 
                  className={`h-full transition-all duration-150 ${testHeadingError < 0 ? 'bg-cyan-500' : 'bg-amber-500'}`} 
                  style={{ width: `${pwmPercentage}%` }}
                ></div>
              </div>
            </div>

            {/* VOLTAGE STATE & DETECTOR PIN DIRECTION STATE */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-2 bg-zinc-900/60 rounded border border-zinc-900 text-center">
                <div className="text-[8px] text-zinc-500">H-BRIDGE DIR STATE</div>
                <strong className={`text-[11px] block mt-1 ${isWithinDeadband ? 'text-zinc-500' : 'text-zinc-100'}`}>
                  {simulatedDirection}
                </strong>
              </div>
              <div className="p-2 bg-zinc-900/60 rounded border border-zinc-900 text-center">
                <div className="text-[8px] text-zinc-500">STEERING DEADBAND</div>
                <strong className={`text-[11px] block mt-1 ${isWithinDeadband ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {isWithinDeadband ? "ACTIVE (IDLE)" : "OUTSIDE (DRIVING)"}
                </strong>
              </div>
            </div>

            {/* SIMULATED PIN LABELS */}
            <div className="space-y-2 pt-2 border-t border-zinc-900">
              <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider mb-1.5">Microcontroller Channel Outputs</div>
              
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">SPEED ENABLE (PIN_MOTOR_PWM):</span>
                <span className={`px-2 py-0.5 rounded font-black text-[10px] ${simulatedPwm > 0 ? 'bg-cyan-500/10 text-cyan-400 animate-pulse' : 'bg-zinc-900 text-zinc-650'}`}>
                  PWM_VAL ({simulatedPwm})
                </span>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">PORT SWITCH (PIN_MOTOR_DIR_A):</span>
                <span className={`px-2 py-0.5 rounded font-black text-[10px] ${pinAState === 'HIGH' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-900 text-zinc-650'}`}>
                  {pinAState}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">STB SWITCH (PIN_MOTOR_DIR_B):</span>
                <span className={`px-2 py-0.5 rounded font-black text-[10px] ${pinBState === 'HIGH' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-900 text-zinc-650'}`}>
                  {pinBState}
                </span>
              </div>
            </div>

          </div>

          {/* DANGERS/LIMIT ALERT */}
          {absError > 25 && (
            <div className="bg-rose-950/20 border border-rose-900/30 text-rose-300 p-3 rounded-xl flex gap-2.5 items-start text-[10.5px] font-mono leading-relaxed">
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <strong className="block text-rose-400 uppercase text-[11px] mb-0.5">High Steering Current Risk</strong>
                Motor is outputting high torque PWM. Open loop operations for long bursts may reach mechanical stops. Limit safety checks (MAX_SINGLE_DIR_TRAVEL_MS) are armed in memory.
              </div>
            </div>
          )}
        </div>

        {/* C++ EXPORTER CONTAINER */}
        <div className="bg-zinc-900/45 border border-zinc-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold font-mono text-zinc-300 uppercase tracking-wider">
              actuator_config.h C++ Code
            </h3>
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1 text-[10px] font-mono font-bold text-cyan-400 hover:text-cyan-300 bg-zinc-950 px-2 py-1 rounded border border-zinc-800"
            >
              {copiedText ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedText ? "Copied" : "COPY HEADER"}
            </button>
          </div>

          <pre className="bg-zinc-950 text-zinc-400 text-xs font-mono p-4 rounded-xl overflow-x-auto border border-zinc-850 select-text leading-5">
            {generatedCodeString}
          </pre>

          <button
            onClick={downloadCalibrationHeader}
            className="w-full py-3 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white font-mono font-bold uppercase rounded-xl border border-cyan-500/10 flex items-center justify-center gap-2 text-xs tracking-wider transition-all shadow-md shadow-cyan-950/20"
          >
            <Download className="h-3.5 w-3.5" />
            Download config header (.h)
          </button>
        </div>

      </div>

    </div>
  );
}

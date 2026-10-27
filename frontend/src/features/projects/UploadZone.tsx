/**
 * features/projects/UploadZone.tsx
 * Clean drag-and-drop / click-to-select upload area.
 */
import type React from 'react';
import { useRef, useState, useCallback } from 'react';
import { Upload } from 'lucide-react';

const ACCEPTED = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];

interface Props {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export const UploadZone: React.FC<Props> = ({ onFileSelected, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED.includes(ext)) {
        alert(`Format tidak didukung: ${ext}\nDiterima: ${ACCEPTED.join(', ')}`);
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  return (
    <div
      id="upload-dropzone"
      className={`dropzone${dragging ? ' drag-over' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={disabled ? undefined : onDragOver}
      onDragLeave={disabled ? undefined : onDragLeave}
      onDrop={disabled ? undefined : onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Area unggah video"
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        style={{ display: 'none' }}
        onChange={onInputChange}
        disabled={disabled}
        aria-hidden
      />

      <div className="dropzone-icon">
        <Upload size={18} />
      </div>

      <div>
        <div className="dropzone-label">
          {dragging ? 'Lepaskan file di sini' : 'Klik atau seret file video'}
        </div>
        <div className="dropzone-hint" style={{ marginTop: 4 }}>
          MP4, MOV, MKV, WebM, AVI — maks. tidak terbatas
        </div>
      </div>

      {!disabled && (
        <button
          id="btn-select-file"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 4, pointerEvents: 'none' }}
          tabIndex={-1}
          type="button"
        >
          Pilih File Video
        </button>
      )}
    </div>
  );
};

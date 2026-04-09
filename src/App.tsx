import React, { useState } from 'react';
import { Upload, FileText, Settings, Play, Download, AlertCircle, CheckCircle2, FileCode2, Terminal, Plus, Trash2, Zap, Copy, Check } from 'lucide-react';

const PYTHON_SCRIPT = `import argparse
import sys

def process_locally(gro_content, top_content, atoms_to_delete, charge_adjustments, new_bonds):
    # 1. Process GRO
    gro_lines = gro_content.split('\\n')
    new_gro_lines = []
    atom_count = int(gro_lines[1].strip()) if len(gro_lines) > 1 else 0

    new_gro_lines.append(gro_lines[0])

    current_gro_idx = 1
    for i in range(2, len(gro_lines) - 1):
        line = gro_lines[i]
        if not line.strip(): continue
        res_id = line[0:5].strip()
        atom_name = line[10:15].strip()

        is_deleted = any(a['resId'] == res_id and a['atomName'] == atom_name for a in atoms_to_delete)
        if is_deleted:
            atom_count -= 1
        else:
            new_line = line[:15] + str(current_gro_idx).rjust(5) + line[20:]
            new_gro_lines.append(new_line)
            current_gro_idx += 1

    new_gro_lines.insert(1, str(atom_count).rjust(5))
    if len(gro_lines) > 2:
        new_gro_lines.append(gro_lines[-1])

    # 2. Process TOP
    top_lines = top_content.split('\\n')
    new_top_lines = []
    deleted_top_indices = set()
    old_to_new = {}
    current_section = ''
    offset = 0

    for line in top_lines:
        if line.strip().startswith('['):
            current_section = line.strip()

        if current_section == '[ atoms ]' and line.strip() and not line.strip().startswith(';') and not line.strip().startswith('['):
            parts = line.strip().split()
            if len(parts) >= 7:
                nr = int(parts[0])
                res_id = parts[2]
                atom_name = parts[4]

                is_deleted = any(a['resId'] == res_id and a['atomName'] == atom_name for a in atoms_to_delete)
                if is_deleted:
                    deleted_top_indices.add(nr)
                    offset += 1
                    continue
                else:
                    old_to_new[nr] = nr - offset
                    adj = next((a for a in charge_adjustments if a['resId'] == res_id and a['atomName'] == atom_name), None)
                    if adj or offset > 0:
                        parts[0] = str(nr - offset)
                        if adj:
                            parts[6] = adj['newCharge']
                        line = f" {parts[0]:>6} {parts[1]:>10} {parts[2]:>6} {parts[3]:>6} {parts[4]:>6} {parts[5]:>6} {parts[6]:>10} {' '.join(parts[7:])}"
        new_top_lines.append(line)

    final_top_lines = []
    current_section = ''
    sections_to_update = ['[ bonds ]', '[ pairs ]', '[ angles ]', '[ dihedrals ]', '[ cmap ]']

    for line in new_top_lines:
        if line.strip().startswith('['):
            current_section = line.strip()
            final_top_lines.append(line)
            continue

        if current_section in sections_to_update and line.strip() and not line.strip().startswith(';'):
            parts = line.strip().split()
            num_indices = 3 if current_section == '[ angles ]' else 4 if current_section == '[ dihedrals ]' else 5 if current_section == '[ cmap ]' else 2

            skip = False
            for i in range(min(num_indices, len(parts))):
                idx = int(parts[i])
                if idx in deleted_top_indices:
                    skip = True
                    break
                if idx in old_to_new:
                    parts[i] = str(old_to_new[idx])
            
            if skip: continue

            if len(parts) > 0 and parts[0].lstrip('-').isdigit():
                line = '  ' + ' '.join(parts)
        
        final_top_lines.append(line)

    if new_bonds:
        bond_idx = -1
        for i, line in enumerate(final_top_lines):
            if '[ bonds ]' in line:
                bond_idx = i
                break
        
        if bond_idx != -1:
            new_bonds_lines = []
            for b in new_bonds:
                idx1, idx2 = -1, -1
                in_atoms = False
                for line in final_top_lines:
                    if '[ atoms ]' in line:
                        in_atoms = True
                    elif line.strip().startswith('['):
                        in_atoms = False

                    if in_atoms and line.strip() and not line.strip().startswith(';'):
                        parts = line.strip().split()
                        if len(parts) >= 7:
                            if parts[2] == b['resId1'] and parts[4] == b['atomName1']:
                                idx1 = int(parts[0])
                            if parts[2] == b['resId2'] and parts[4] == b['atomName2']:
                                idx2 = int(parts[0])
                
                if idx1 != -1 and idx2 != -1:
                    new_bonds_lines.append(f"  {idx1} {idx2} {b.get('params', '1')}")
                else:
                    new_bonds_lines.append(f"; Failed to resolve indices for bond {b['resId1']}-{b['atomName1']} to {b['resId2']}-{b['atomName2']}")
            
            final_top_lines[bond_idx+1:bond_idx+1] = new_bonds_lines

    return '\\n'.join(new_gro_lines), '\\n'.join(final_top_lines)

def parse_args():
    parser = argparse.ArgumentParser(description="grotop: 100% Local GROMACS GRO/TOP Modifier")
    parser.add_argument('--gro', required=True, help="Input GRO file")
    parser.add_argument('--top', required=True, help="Input TOP file")
    parser.add_argument('--out_gro', default="modified.gro", help="Output GRO file")
    parser.add_argument('--out_top', default="modified.top", help="Output TOP file")
    
    parser.add_argument('--delete', nargs='*', default=[], help="Atoms to delete. Format: resId:atomName")
    parser.add_argument('--charge', nargs='*', default=[], help="Charge adjustments. Format: resId:atomName:newCharge")
    parser.add_argument('--bond', nargs='*', default=[], help="New bonds. Format: resId1:atomName1:resId2:atomName2:params")

    return parser.parse_args()

def main():
    args = parse_args()

    atoms_to_delete = [{'resId': p.split(':')[0], 'atomName': p.split(':')[1]} for p in args.delete]
    charge_adjustments = [{'resId': p.split(':')[0], 'atomName': p.split(':')[1], 'newCharge': p.split(':')[2]} for p in args.charge]
    new_bonds = []
    for b in args.bond:
        parts = b.split(':')
        params = parts[4] if len(parts) > 4 else '1'
        new_bonds.append({'resId1': parts[0], 'atomName1': parts[1], 'resId2': parts[2], 'atomName2': parts[3], 'params': params})

    print("Reading files...")
    with open(args.gro, 'r') as f: gro_content = f.read()
    with open(args.top, 'r') as f: top_content = f.read()

    print("Processing files locally...")
    mod_gro, mod_top = process_locally(gro_content, top_content, atoms_to_delete, charge_adjustments, new_bonds)

    with open(args.out_gro, 'w') as f: f.write(mod_gro)
    with open(args.out_top, 'w') as f: f.write(mod_top)

    print(f"Done! Saved to {args.out_gro} and {args.out_top}")

if __name__ == "__main__":
    main()
`;

interface AtomDef { resId: string; atomName: string; }
interface ChargeDef extends AtomDef { newCharge: string; }
interface BondDef { resId1: string; atomName1: string; resId2: string; atomName2: string; params: string; }
interface BondUpdateDef { resId: string; atomName1: string; atomName2: string; newParams: string; }
interface BondDeleteDef { resId1: string; atomName1: string; resId2: string; atomName2: string; }

export default function App() {
  const [groContent, setGroContent] = useState<string>('');
  const [groName, setGroName] = useState<string>('');
  const [topContent, setTopContent] = useState<string>('');
  const [topName, setTopName] = useState<string>('');
  const [itpContent, setItpContent] = useState<string>('');
  const [itpName, setItpName] = useState<string>('');
  const [posreContent, setPosreContent] = useState<string>('');
  const [posreName, setPosreName] = useState<string>('');

  // Smart Setup State
  const [res1, setRes1] = useState('');
  const [atom1, setAtom1] = useState('');
  const [res2, setRes2] = useState('');
  const [atom2, setAtom2] = useState('');
  const [bondType, setBondType] = useState('peptide');

  // Manual Rules State
  const [atomsToDelete, setAtomsToDelete] = useState<AtomDef[]>([]);
  const [chargeAdjustments, setChargeAdjustments] = useState<ChargeDef[]>([]);
  const [newBonds, setNewBonds] = useState<BondDef[]>([]);
  const [bondsToUpdate, setBondsToUpdate] = useState<BondUpdateDef[]>([]);
  const [bondsToDelete, setBondsToDelete] = useState<BondDeleteDef[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [result, setResult] = useState<{
    modifiedGro: string;
    modifiedTop: string;
    modifiedItp: string | null;
    modifiedPosre: string | null;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'gro' | 'top' | 'itp' | 'posre'>('gro');

  const [copiedGro, setCopiedGro] = useState(false);
  const [copiedTop, setCopiedTop] = useState(false);
  const [copiedItp, setCopiedItp] = useState(false);
  const [copiedPosre, setCopiedPosre] = useState(false);

  const copyToClipboard = async (content: string, type: 'gro' | 'top' | 'itp' | 'posre') => {
    try {
      await navigator.clipboard.writeText(content);
      if (type === 'gro') {
        setCopiedGro(true);
        setTimeout(() => setCopiedGro(false), 2000);
      } else if (type === 'top') {
        setCopiedTop(true);
        setTimeout(() => setCopiedTop(false), 2000);
      } else if (type === 'itp') {
        setCopiedItp(true);
        setTimeout(() => setCopiedItp(false), 2000);
      } else {
        setCopiedPosre(true);
        setTimeout(() => setCopiedPosre(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setError('Failed to copy to clipboard. Please select the text manually.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setContent: (c: string) => void, setName: (n: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      setName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        setContent(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handleAutoGenerateRules = () => {
    const contentToParse = itpContent || topContent;
    if (!contentToParse) {
      setError('Please upload a TOP or ITP file first so the algorithm can read the charges.');
      return;
    }
    if (!res1 || !res2) {
      setError('Please fill in both Residue IDs.');
      return;
    }

    setError(null);

    try {
      // Parse atoms from TOP/ITP file
      const atoms: any[] = [];
      let inAtoms = false;
      const lines = contentToParse.split('\n');
      for (const line of lines) {
          if (line.trim().startsWith('[')) {
              inAtoms = line.trim() === '[ atoms ]';
              continue;
          }
          if (inAtoms && line.trim() && !line.trim().startsWith(';')) {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 7) {
                  atoms.push({
                      resId: parts[2],
                      resName: parts[3],
                      atomName: parts[4],
                      charge: parseFloat(parts[6]),
                  });
              }
          }
      }

      const cleanRes1 = res1.trim();
      const cleanRes2 = res2.trim();

      const res1Atoms = atoms.filter(a => a.resId === cleanRes1);
      const res2Atoms = atoms.filter(a => a.resId === cleanRes2);

      if (res1Atoms.length === 0 || res2Atoms.length === 0) {
          throw new Error(`Could not find atoms for residues ${cleanRes1} and/or ${cleanRes2} in the TOP/ITP file. Check residue IDs.`);
      }

      let newAtomsToDelete: AtomDef[] = [];
      let newChargeAdjustments: ChargeDef[] = [];
      let newBondsList: BondDef[] = [];
      let newBondsToUpdate: BondUpdateDef[] = [];
      let newBondsToDelete: BondDeleteDef[] = [];

      if (bondType === 'peptide') {
          // Res 1: Carboxyl side
          let targetC = atom1.trim() || 'C';
          const c = res1Atoms.find(a => a.atomName === targetC);
          if (!c) throw new Error(`Atom ${targetC} not found in Residue ${cleanRes1}`);

          if (targetC === 'C') {
              let nextResId = String(parseInt(cleanRes1) + 1);
              let nextResAtoms = atoms.filter(a => a.resId === nextResId);
              if (nextResAtoms.some(a => a.atomName === 'N')) {
                  newBondsToDelete.push({ resId1: cleanRes1, atomName1: 'C', resId2: nextResId, atomName2: 'N' });
              }
          }

          let oxygens = [];
          let oToKeep: any = null;
          if (targetC === 'C') {
              oxygens = res1Atoms.filter(a => ['O', 'OXT', 'OT1', 'OT2', 'O1', 'O2'].includes(a.atomName));
              oToKeep = oxygens.find(a => a.atomName === 'O') || oxygens[0];
          } else if (targetC === 'CG') { // ASP
              oxygens = res1Atoms.filter(a => ['OD1', 'OD2'].includes(a.atomName));
              oToKeep = oxygens.find(a => a.atomName === 'OD1') || oxygens[0];
          } else if (targetC === 'CD') { // GLU
              oxygens = res1Atoms.filter(a => ['OE1', 'OE2'].includes(a.atomName));
              oToKeep = oxygens.find(a => a.atomName === 'OE1') || oxygens[0];
          } else {
              oxygens = res1Atoms.filter(a => a.atomName.startsWith('O'));
              oToKeep = oxygens[0];
          }
          
          if (oxygens.length > 1 && oToKeep) {
              const oToDelete = oxygens.filter(a => a.atomName !== oToKeep.atomName);
              
              let totalDeletedCharge = 0;
              oToDelete.forEach(o => {
                  newAtomsToDelete.push({ resId: cleanRes1, atomName: o.atomName });
                  totalDeletedCharge += o.charge;
              });
              newChargeAdjustments.push({ resId: cleanRes1, atomName: targetC, newCharge: (c.charge + totalDeletedCharge).toFixed(4) });
              
              // Force the remaining C-O bond to be a C=O double bond
              newBondsToUpdate.push({
                  resId: cleanRes1,
                  atomName1: targetC,
                  atomName2: oToKeep.atomName,
                  newParams: '1 0.12300 502080.0'
              });
          }

          // Res 2: Amine side
          let targetN = atom2.trim() || 'N';
          const n = res2Atoms.find(a => a.atomName === targetN);
          if (!n) throw new Error(`Atom ${targetN} not found in Residue ${cleanRes2}`);

          if (targetN === 'N') {
              let prevResId = String(parseInt(cleanRes2) - 1);
              let prevResAtoms = atoms.filter(a => a.resId === prevResId);
              if (prevResAtoms.some(a => a.atomName === 'C')) {
                  newBondsToDelete.push({ resId1: prevResId, atomName1: 'C', resId2: cleanRes2, atomName2: 'N' });
              }
          }

          let hydrogens = [];
          let numToKeep = 1;

          if (targetN === 'N') {
              hydrogens = res2Atoms.filter(a => ['H', 'HN', 'H1', 'H2', 'H3', 'HT1', 'HT2', 'HT3'].includes(a.atomName));
              if (n.resName === 'PRO') numToKeep = 0;
          } else if (targetN === 'NZ') { // LYS
              hydrogens = res2Atoms.filter(a => ['HZ1', 'HZ2', 'HZ3'].includes(a.atomName));
          } else if (targetN === 'NE2') { // GLN
              hydrogens = res2Atoms.filter(a => ['HE21', 'HE22'].includes(a.atomName));
          } else if (targetN === 'ND2') { // ASN
              hydrogens = res2Atoms.filter(a => ['HD21', 'HD22'].includes(a.atomName));
          } else {
              hydrogens = res2Atoms.filter(a => a.atomName.startsWith('H'));
          }
          
          if (hydrogens.length > numToKeep) {
              hydrogens.sort((a, b) => a.atomName.localeCompare(b.atomName));
              const hToDelete = hydrogens.slice(numToKeep);
              
              let totalDeletedCharge = 0;
              hToDelete.forEach(h => {
                  newAtomsToDelete.push({ resId: cleanRes2, atomName: h.atomName });
                  totalDeletedCharge += h.charge;
              });
              newChargeAdjustments.push({ resId: cleanRes2, atomName: targetN, newCharge: (n.charge + totalDeletedCharge).toFixed(4) });
          }

          newBondsList.push({ resId1: cleanRes1, atomName1: targetC, resId2: cleanRes2, atomName2: targetN, params: '1 0.13300 337230.4' });
      } else if (bondType === 'disulfide') {
          let targetS1 = atom1.trim() || 'SG';
          let targetS2 = atom2.trim() || 'SG';

          // Res 1: CYS
          const sg1 = res1Atoms.find(a => a.atomName === targetS1);
          const hg1 = res1Atoms.find(a => a.atomName.startsWith('HG'));
          if (sg1 && hg1) {
              newAtomsToDelete.push({ resId: cleanRes1, atomName: hg1.atomName });
              newChargeAdjustments.push({ resId: cleanRes1, atomName: targetS1, newCharge: (sg1.charge + hg1.charge).toFixed(4) });
          }
          
          // Res 2: CYS
          const sg2 = res2Atoms.find(a => a.atomName === targetS2);
          const hg2 = res2Atoms.find(a => a.atomName.startsWith('HG'));
          if (sg2 && hg2) {
              newAtomsToDelete.push({ resId: cleanRes2, atomName: hg2.atomName });
              newChargeAdjustments.push({ resId: cleanRes2, atomName: targetS2, newCharge: (sg2.charge + hg2.charge).toFixed(4) });
          }
          
          newBondsList.push({ resId1: cleanRes1, atomName1: targetS1, resId2: cleanRes2, atomName2: targetS2, params: '1 0.20380 139745.6' });
      }

      setAtomsToDelete(prev => {
          const combined = [...prev, ...newAtomsToDelete];
          return combined.filter((v, i, a) => a.findIndex(t => t.resId === v.resId && t.atomName === v.atomName) === i);
      });
      setChargeAdjustments(prev => {
          const combined = [...prev, ...newChargeAdjustments];
          return combined.filter((v, i, a) => a.findIndex(t => t.resId === v.resId && t.atomName === v.atomName) === i);
      });
      setNewBonds(prev => {
          const combined = [...prev, ...newBondsList];
          return combined.filter((v, i, a) => a.findIndex(t => 
              (t.resId1 === v.resId1 && t.atomName1 === v.atomName1 && t.resId2 === v.resId2 && t.atomName2 === v.atomName2) ||
              (t.resId1 === v.resId2 && t.atomName1 === v.atomName2 && t.resId2 === v.resId1 && t.atomName2 === v.atomName1)
          ) === i);
      });
      setBondsToUpdate(prev => {
          const combined = [...prev, ...newBondsToUpdate];
          return combined.filter((v, i, a) => a.findIndex(t => 
              t.resId === v.resId && 
              ((t.atomName1 === v.atomName1 && t.atomName2 === v.atomName2) || 
               (t.atomName1 === v.atomName2 && t.atomName2 === v.atomName1))
          ) === i);
      });
      setBondsToDelete(prev => {
          const combined = [...prev, ...newBondsToDelete];
          return combined.filter((v, i, a) => a.findIndex(t => 
              (t.resId1 === v.resId1 && t.atomName1 === v.atomName1 && t.resId2 === v.resId2 && t.atomName2 === v.atomName2) ||
              (t.resId1 === v.resId2 && t.atomName1 === v.atomName2 && t.resId2 === v.resId1 && t.atomName2 === v.atomName1)
          ) === i);
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate rules algorithmically.');
    }
  };

  const processLocally = (gro: string, top: string, itp: string | null, instructions: any) => {
    const { atomsToDelete = [], chargeAdjustments = [], newBonds = [], bondsToUpdate = [], bondsToDelete = [] } = instructions;

    // 1. Process GRO
    let newGroLines: string[] = [];
    if (gro) {
        let groLines = gro.split('\n');
        let atomCount = parseInt(groLines[1]?.trim() || '0');

        newGroLines.push(groLines[0]); // Title

        let currentGroIdx = 1;
        for (let i = 2; i < groLines.length - 1; i++) {
            let line = groLines[i];
            if (!line.trim()) continue;
            let resId = line.substring(0, 5).trim();
            let atomName = line.substring(10, 15).trim();

            let isDeleted = atomsToDelete.some((a: any) => a.resId === resId && a.atomName === atomName);
            if (isDeleted) {
                atomCount--;
            } else {
                let newLine = line.substring(0, 15) + currentGroIdx.toString().padStart(5) + line.substring(20);
                newGroLines.push(newLine);
                currentGroIdx++;
            }
        }
        newGroLines.splice(1, 0, atomCount.toString().padStart(5));
        if (groLines.length > 2) newGroLines.push(groLines[groLines.length - 1]); // Box vectors
    }

    const processTopology = (topoContent: string) => {
        if (!topoContent) return topoContent;
        let lines = topoContent.split('\n');
        let newLines = [];
        let deletedIndices = new Set<number>();
        let oldToNew = new Map<number, number>();
        let atomNames = new Map<number, string>(); // Store new index -> atom name
        let atomMap = new Map<string, number>(); // Store "resId_atomName" -> old index
        let currentSection = '';
        let offset = 0;
        
        let lastOldCgnr = -1;
        let currentNewCgnr = 0;

        for (let line of lines) {
            if (line.trim().startsWith('[')) currentSection = line.trim();

            if (currentSection === '[ atoms ]' && line.trim() && !line.trim().startsWith(';') && !line.trim().startsWith('[')) {
                let parts = line.trim().split(/\s+/);
                if (parts.length >= 7) {
                    let nr = parseInt(parts[0]);
                    let resId = parts[2];
                    let atomName = parts[4];
                    
                    atomMap.set(`${resId}_${atomName}`, nr);

                    let isDeleted = atomsToDelete.some((a: any) => a.resId === resId && a.atomName === atomName);
                    if (isDeleted) {
                        deletedIndices.add(nr);
                        offset++;
                        continue;
                    } else {
                        let newNr = nr - offset;
                        oldToNew.set(nr, newNr);
                        atomNames.set(newNr, atomName);
                        
                        let adj = chargeAdjustments.find((a: any) => a.resId === resId && a.atomName === atomName);
                        
                        let oldCgnr = parseInt(parts[5]);
                        if (oldCgnr !== lastOldCgnr) {
                            currentNewCgnr++;
                            lastOldCgnr = oldCgnr;
                        }
                        
                        if (adj || offset > 0 || oldCgnr !== currentNewCgnr) {
                            parts[0] = newNr.toString();
                            parts[5] = currentNewCgnr.toString();
                            if (adj) parts[6] = adj.newCharge;
                            line = ` ${parts[0].padStart(6)} ${parts[1].padStart(10)} ${parts[2].padStart(6)} ${parts[3].padStart(6)} ${parts[4].padStart(6)} ${parts[5].padStart(6)} ${parts[6].padStart(10)} ${parts.slice(7).join(' ')}`;
                        }
                    }
                }
            }
            newLines.push(line);
        }

        let resolvedBondsToUpdate = bondsToUpdate.map((b: any) => {
            let u = atomMap.get(`${b.resId}_${b.atomName1}`);
            let v = atomMap.get(`${b.resId}_${b.atomName2}`);
            return { u, v, newParams: b.newParams };
        }).filter((b: any) => b.u !== undefined && b.v !== undefined);

        let resolvedBondsToDelete = bondsToDelete.map((b: any) => {
            let u = atomMap.get(`${b.resId1}_${b.atomName1}`);
            let v = atomMap.get(`${b.resId2}_${b.atomName2}`);
            return { u, v };
        }).filter((b: any) => b.u !== undefined && b.v !== undefined);

        const isBondDeleted = (u: number, v: number) => {
            return resolvedBondsToDelete.some((b: any) => (b.u === u && b.v === v) || (b.u === v && b.v === u));
        };

        const hasDeletedBondAdjacently = (indices: number[]) => {
            for (let i = 0; i < indices.length - 1; i++) {
                if (isBondDeleted(indices[i], indices[i+1])) return true;
            }
            return false;
        };

        let tempLines = [];
        currentSection = '';
        let sectionsToUpdate = ['[ bonds ]', '[ pairs ]', '[ angles ]', '[ dihedrals ]', '[ cmap ]'];

        for (let line of newLines) {
            if (line.trim().startsWith('[')) {
                currentSection = line.trim();
                tempLines.push(line);
                continue;
            }

            if (sectionsToUpdate.includes(currentSection) && line.trim() && !line.trim().startsWith(';')) {
                let parts = line.trim().split(/\s+/);
                let numIndices = currentSection === '[ angles ]' ? 3 : currentSection === '[ dihedrals ]' ? 4 : currentSection === '[ cmap ]' ? 5 : 2;

                let skip = false;
                let oldIndices = [];
                for (let i = 0; i < numIndices && i < parts.length; i++) {
                    let idx = parseInt(parts[i]);
                    oldIndices.push(idx);
                    if (deletedIndices.has(idx)) { skip = true; break; }
                    if (oldToNew.has(idx)) parts[i] = oldToNew.get(idx)!.toString();
                }
                if (skip) continue;

                if (currentSection === '[ bonds ]') {
                    if (isBondDeleted(oldIndices[0], oldIndices[1])) continue;
                    
                    let update = resolvedBondsToUpdate.find((b: any) => 
                        (b.u === oldIndices[0] && b.v === oldIndices[1]) || 
                        (b.u === oldIndices[1] && b.v === oldIndices[0])
                    );
                    if (update) {
                        line = `  ${parts[0]} ${parts[1]} ${update.newParams}`;
                    } else if (parts.length > 0 && !isNaN(parseInt(parts[0]))) {
                        line = '  ' + parts.join(' ');
                    }
                } else if (currentSection === '[ angles ]' || currentSection === '[ dihedrals ]' || currentSection === '[ cmap ]') {
                    if (hasDeletedBondAdjacently(oldIndices)) continue;
                    if (parts.length > 0 && !isNaN(parseInt(parts[0]))) {
                        line = '  ' + parts.join(' ');
                    }
                } else {
                    // [ pairs ]
                    if (parts.length > 0 && !isNaN(parseInt(parts[0]))) {
                        line = '  ' + parts.join(' ');
                    }
                }
            }
            tempLines.push(line);
        }

        // Build adjList from tempLines to filter pairs
        let adjList = new Map<number, Set<number>>();
        let inBonds = false;
        for (let line of tempLines) {
            if (line.trim().startsWith('[')) {
                inBonds = line.trim() === '[ bonds ]';
                continue;
            }
            if (inBonds && line.trim() && !line.trim().startsWith(';')) {
                let parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    let u = parseInt(parts[0]);
                    let v = parseInt(parts[1]);
                    if (!isNaN(u) && !isNaN(v)) {
                        if (!adjList.has(u)) adjList.set(u, new Set());
                        if (!adjList.has(v)) adjList.set(v, new Set());
                        adjList.get(u)!.add(v);
                        adjList.get(v)!.add(u);
                    }
                }
            }
        }

        // Add new bonds to adjList so pairs filtering is accurate
        let resolvedNewBonds: {u: number, v: number, params: string}[] = [];
        let newBondsLines = newBonds.map((b: any) => {
            let u = atomMap.get(`${b.resId1}_${b.atomName1}`);
            let v = atomMap.get(`${b.resId2}_${b.atomName2}`);
            if (u !== undefined && v !== undefined) {
                let newU = oldToNew.get(u) || u;
                let newV = oldToNew.get(v) || v;
                resolvedNewBonds.push({ u: newU, v: newV, params: b.params });
                if (!adjList.has(newU)) adjList.set(newU, new Set());
                if (!adjList.has(newV)) adjList.set(newV, new Set());
                adjList.get(newU)!.add(newV);
                adjList.get(newV)!.add(newU);
                return `  ${newU} ${newV} ${b.params}`;
            }
            return null;
        }).filter((l: any) => l !== null);

        const getShortestPath = (start: number, target: number, maxDepth: number) => {
            if (start === target) return 0;
            let queue = [{ node: start, depth: 0 }];
            let visited = new Set<number>([start]);
            while (queue.length > 0) {
                let { node, depth } = queue.shift()!;
                if (depth === maxDepth) continue;
                let neighbors = adjList.get(node) || new Set();
                for (let neighbor of neighbors) {
                    if (neighbor === target) return depth + 1;
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push({ node: neighbor, depth: depth + 1 });
                    }
                }
            }
            return -1;
        };

        let finalLines = [];
        currentSection = '';
        for (let line of tempLines) {
            if (line.trim().startsWith('[')) {
                currentSection = line.trim();
                finalLines.push(line);
                continue;
            }
            
            if (currentSection === '[ pairs ]' && line.trim() && !line.trim().startsWith(';')) {
                let parts = line.trim().split(/\s+/);
                let u = parseInt(parts[0]);
                let v = parseInt(parts[1]);
                if (!isNaN(u) && !isNaN(v)) {
                    let dist = getShortestPath(u, v, 4);
                    if (dist !== 3) {
                        continue; // Skip pair if it's no longer exactly 3 bonds away
                    }
                }
            }
            finalLines.push(line);
        }

        if (resolvedNewBonds.length > 0) {
            let bondIdx = finalLines.findIndex(l => l.trim() === '[ bonds ]');
            if (bondIdx !== -1) {
                // --- NEW GRAPH TRAVERSAL LOGIC FOR TOPOLOGY COMPLETION ---
                // Adjacency list is already built above!
                // 2. Determine function types from existing topology
                let functAngles = '1', functPairs = '1', functDihedrals = '9';
                let currentSecForFunct = '';
                for (let line of finalLines) {
                    let tline = line.trim();
                    if (tline.startsWith('[')) { currentSecForFunct = tline; continue; }
                    if (tline && !tline.startsWith(';')) {
                        let parts = tline.split(/\s+/);
                        if (currentSecForFunct === '[ angles ]' && parts.length >= 4) functAngles = parts[3];
                        if (currentSecForFunct === '[ pairs ]' && parts.length >= 3) functPairs = parts[2];
                        if (currentSecForFunct === '[ dihedrals ]' && parts.length >= 5) functDihedrals = parts[4];
                    }
                }

                // 3. Generate new topology terms
                let pairsSet = new Set<string>();
                let anglesSet = new Set<string>();
                let dihedralsSet = new Set<string>();

                const getAngleParams = (name1: string, name2: string, name3: string) => {
                    if (!name1 || !name2 || !name3) return '1 120.0 400.0';
                    let n1 = name1.charAt(0).toUpperCase();
                    let n2 = name2.charAt(0).toUpperCase();
                    let n3 = name3.charAt(0).toUpperCase();
                    let str = `${n1}-${n2}-${n3}`;
                    let rev = `${n3}-${n2}-${n1}`;
                    
                    if (str === 'O-C-N' || rev === 'O-C-N') return '1 123.0 670.0';
                    if (str === 'C-C-N' || rev === 'C-C-N') return '1 116.6 585.0';
                    if (str === 'C-N-C' || rev === 'C-N-C') return '1 122.0 418.0';
                    if (str === 'C-N-H' || rev === 'C-N-H') return '1 119.8 418.0';
                    if (str === 'C-S-S' || rev === 'C-S-S') return '1 104.0 400.0';
                    
                    return '1 120.0 400.0';
                };

                const getDihedralParams = (name1: string, name2: string, name3: string, name4: string) => {
                    if (!name2 || !name3) return '9 180.0 10.0 2';
                    let n2 = name2.charAt(0).toUpperCase();
                    let n3 = name3.charAt(0).toUpperCase();
                    let core = `${n2}-${n3}`;
                    let revCore = `${n3}-${n2}`;
                    
                    if (core === 'C-N' || revCore === 'C-N') return '9 180.0 10.5 2';
                    if (core === 'S-S') return '9 90.0 15.0 2';
                    
                    return '9 180.0 10.0 2';
                };

                for (let bond of resolvedNewBonds) {
                    let A = bond.u;
                    let B = bond.v;
                    let neighborsA = Array.from(adjList.get(A) || []).filter(x => x !== B);
                    let neighborsB = Array.from(adjList.get(B) || []).filter(x => x !== A);

                    // Angles
                    for (let x of neighborsA) {
                        let a1 = Math.min(x, B), a3 = Math.max(x, B);
                        let params = getAngleParams(atomNames.get(a1)!, atomNames.get(A)!, atomNames.get(a3)!);
                        anglesSet.add(`  ${a1} ${A} ${a3} ${params}`);
                    }
                    for (let y of neighborsB) {
                        let a1 = Math.min(A, y), a3 = Math.max(A, y);
                        let params = getAngleParams(atomNames.get(a1)!, atomNames.get(B)!, atomNames.get(a3)!);
                        anglesSet.add(`  ${a1} ${B} ${a3} ${params}`);
                    }

                    // Dihedrals & Pairs (x-A-B-y) - Rotation around the NEW bond
                    for (let x of neighborsA) {
                        for (let y of neighborsB) {
                            let d1 = x < y ? x : y;
                            let d2 = x < y ? A : B;
                            let d3 = x < y ? B : A;
                            let d4 = x < y ? y : x;
                            let params = getDihedralParams(atomNames.get(d1)!, atomNames.get(d2)!, atomNames.get(d3)!, atomNames.get(d4)!);
                            dihedralsSet.add(`  ${d1} ${d2} ${d3} ${d4} ${params}`);
                            
                            let p1 = Math.min(x, y), p2 = Math.max(x, y);
                            pairsSet.add(`  ${p1} ${p2} 1`);
                        }
                    }

                    // Pairs ONLY (w-x-A-B) - Do not add dihedrals to avoid over-constraining existing bonds
                    for (let x of neighborsA) {
                        let neighborsX = Array.from(adjList.get(x) || []).filter(w => w !== A);
                        for (let w of neighborsX) {
                            let p1 = Math.min(w, B), p2 = Math.max(w, B);
                            pairsSet.add(`  ${p1} ${p2} 1`);
                        }
                    }

                    // Pairs ONLY (A-B-y-z) - Do not add dihedrals to avoid over-constraining existing bonds
                    for (let y of neighborsB) {
                        let neighborsY = Array.from(adjList.get(y) || []).filter(z => z !== B);
                        for (let z of neighborsY) {
                            let p1 = Math.min(A, z), p2 = Math.max(A, z);
                            pairsSet.add(`  ${p1} ${p2} 1`);
                        }
                    }
                }
                
                let generatedPairs = Array.from(pairsSet);
                let generatedAngles = Array.from(anglesSet);
                let generatedDihedrals = Array.from(dihedralsSet);
                // --- END NEW GRAPH TRAVERSAL LOGIC ---
                
                let insertIdx = bondIdx + 1;
                while (insertIdx < finalLines.length && !finalLines[insertIdx].trim().startsWith('[')) {
                    insertIdx++;
                }
                while (insertIdx > bondIdx + 1 && finalLines[insertIdx - 1].trim() === '') {
                    insertIdx--;
                }
                
                finalLines.splice(insertIdx, 0, ...newBondsLines);

                // Helper function to insert generated lines into specific sections
                const insertIntoSection = (sectionName: string, linesToInsert: string[]) => {
                    if (linesToInsert.length === 0) return;
                    let secIdx = finalLines.findIndex(l => l.trim() === sectionName);
                    if (secIdx !== -1) {
                        let idx = secIdx + 1;
                        while (idx < finalLines.length && !finalLines[idx].trim().startsWith('[')) {
                            idx++;
                        }
                        while (idx > secIdx + 1 && finalLines[idx - 1].trim() === '') {
                            idx--;
                        }
                        finalLines.splice(idx, 0, ...linesToInsert);
                    }
                };

                insertIntoSection('[ pairs ]', generatedPairs);
                insertIntoSection('[ angles ]', generatedAngles);
                insertIntoSection('[ dihedrals ]', generatedDihedrals);
            }
        }

        return { content: finalLines.join('\n'), oldToNew, deletedIndices };
    };

    let topResult = processTopology(top);
    let modifiedTop = topResult.content;
    
    let modifiedItp = null;
    let activeOldToNew = topResult.oldToNew;
    let activeDeletedIndices = topResult.deletedIndices;

    if (itp) {
        let itpResult = processTopology(itp);
        modifiedItp = itpResult.content;
        activeOldToNew = itpResult.oldToNew;
        activeDeletedIndices = itpResult.deletedIndices;
    }

    let modifiedPosre = null;
    if (instructions.posre) {
        let posreLines = instructions.posre.split('\n');
        let newPosreLines = [];
        for (let line of posreLines) {
            if (line.trim() && !line.trim().startsWith(';') && !line.trim().startsWith('[')) {
                let parts = line.trim().split(/\s+/);
                let oldIdx = parseInt(parts[0]);
                if (!isNaN(oldIdx)) {
                    if (activeDeletedIndices.has(oldIdx)) {
                        continue; // Skip deleted atom
                    }
                    if (activeOldToNew.has(oldIdx)) {
                        parts[0] = activeOldToNew.get(oldIdx).toString();
                        line = `  ${parts[0].padStart(4)} ${parts.slice(1).join(' ')}`;
                    }
                }
            }
            newPosreLines.push(line);
        }
        modifiedPosre = newPosreLines.join('\n');
    }

    return { modifiedGro: newGroLines.join('\n'), modifiedTop, modifiedItp, modifiedPosre };
  };

  const handleProcess = () => {
    if (!groContent || !topContent) {
      setError('Please upload GRO and TOP files.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const validAtomsToDelete = atomsToDelete
        .filter(a => a.resId.trim() && a.atomName.trim())
        .map(a => ({ ...a, resId: a.resId.trim(), atomName: a.atomName.trim() }));
        
      const validChargeAdjustments = chargeAdjustments
        .filter(a => a.resId.trim() && a.atomName.trim() && a.newCharge.trim())
        .map(a => ({ ...a, resId: a.resId.trim(), atomName: a.atomName.trim(), newCharge: a.newCharge.trim() }));
        
      const validNewBonds = newBonds
        .filter(b => b.resId1.trim() && b.atomName1.trim() && b.resId2.trim() && b.atomName2.trim())
        .map(b => ({ ...b, resId1: b.resId1.trim(), atomName1: b.atomName1.trim(), resId2: b.resId2.trim(), atomName2: b.atomName2.trim(), params: b.params.trim() }));
        
      const validBondsToUpdate = bondsToUpdate
        .filter(b => b.resId.trim() && b.atomName1.trim() && b.atomName2.trim())
        .map(b => ({ ...b, resId: b.resId.trim(), atomName1: b.atomName1.trim(), atomName2: b.atomName2.trim(), newParams: b.newParams.trim() }));
        
      const validBondsToDelete = bondsToDelete
        .filter(b => b.resId1.trim() && b.atomName1.trim() && b.resId2.trim() && b.atomName2.trim())
        .map(b => ({ ...b, resId1: b.resId1.trim(), atomName1: b.atomName1.trim(), resId2: b.resId2.trim(), atomName2: b.atomName2.trim() }));

      const instructions = {
        atomsToDelete: validAtomsToDelete,
        chargeAdjustments: validChargeAdjustments,
        newBonds: validNewBonds,
        bondsToUpdate: validBondsToUpdate,
        bondsToDelete: validBondsToDelete,
        posre: posreContent || null
      };

      const { modifiedGro, modifiedTop, modifiedItp, modifiedPosre } = processLocally(groContent, topContent, itpContent, instructions);
      
      setResult({
        modifiedGro,
        modifiedTop,
        modifiedItp,
        modifiedPosre
      });
      setActiveTab('gro');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const updateArray = (setter: any, index: number, field: string, value: string) => {
    setter((prev: any[]) => {
      const newArr = [...prev];
      newArr[index] = { ...newArr[index], [field]: value };
      return newArr;
    });
  };

  const removeFromArray = (setter: any, index: number) => {
    setter((prev: any[]) => prev.filter((_, i) => i !== index));
  };

  const addToArray = (setter: any, emptyObj: any) => {
    setter((prev: any[]) => [...prev, emptyObj]);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-12">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-800">grotop</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Inputs */}
          <div className="lg:col-span-5 space-y-6 sticky top-24 h-[calc(100vh-8rem)] overflow-y-auto pr-2 pb-4">
            
            {/* File Uploads */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" />
                Upload Files
              </h2>
              
              <div className="space-y-4">
                <FileUploadBox 
                  id="gro-upload" 
                  label="GRO File" 
                  fileName={groName} 
                  accept=".gro"
                  onChange={(e) => handleFileUpload(e, setGroContent, setGroName)} 
                />
                <FileUploadBox 
                  id="top-upload" 
                  label="TOP File" 
                  fileName={topName} 
                  accept=".top"
                  onChange={(e) => handleFileUpload(e, setTopContent, setTopName)} 
                />
                <FileUploadBox 
                  id="itp-upload" 
                  label="ITP File (Optional)" 
                  fileName={itpName} 
                  accept=".itp"
                  onChange={(e) => handleFileUpload(e, setItpContent, setItpName)} 
                />
                <FileUploadBox 
                  id="posre-upload" 
                  label="posre.itp File (Optional)" 
                  fileName={posreName} 
                  accept=".itp"
                  onChange={(e) => handleFileUpload(e, setPosreContent, setPosreName)} 
                />
                <p className="text-xs text-slate-500">
                  <strong>Note:</strong> If your system has multiple chains, upload the specific <code>.itp</code> file for the chain you want to modify. If you have position restraints, upload the <code>posre.itp</code> file so atom indices can be updated synchronously.
                </p>
              </div>
            </section>

            {/* Algorithmic Smart Setup */}
            <section className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl shadow-sm border border-indigo-100 p-5">
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2 text-indigo-900">
                <Zap className="w-5 h-5 text-indigo-600" />
                Algorithmic Rule Generator
              </h2>
              <p className="text-sm text-indigo-700/80 mb-4">
                Select the bond type and residues. The built-in algorithm will parse your TOP file, identify atoms to delete (like OXT/H), and balance charges automatically based on standard forcefield rules. No AI needed.
              </p>
              
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-indigo-900 mb-1">Residue 1 ID</label>
                    <input type="text" value={res1} onChange={e => setRes1(e.target.value)} placeholder="e.g. 1" className="w-full rounded border border-indigo-200 px-3 py-2 text-sm" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-indigo-900 mb-1">Atom 1 (Carboxyl Carbon)</label>
                    <input type="text" value={atom1} onChange={e => setAtom1(e.target.value)} placeholder="e.g. C (main), CG (ASP), CD (GLU)" className="w-full rounded border border-indigo-200 px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-indigo-900 mb-1">Residue 2 ID</label>
                    <input type="text" value={res2} onChange={e => setRes2(e.target.value)} placeholder="e.g. 10" className="w-full rounded border border-indigo-200 px-3 py-2 text-sm" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-indigo-900 mb-1">Atom 2 (Amine Nitrogen)</label>
                    <input type="text" value={atom2} onChange={e => setAtom2(e.target.value)} placeholder="e.g. N (main), NZ (LYS)" className="w-full rounded border border-indigo-200 px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-indigo-900 mb-1">Bond Type</label>
                  <select 
                    value={bondType} 
                    onChange={e => setBondType(e.target.value)}
                    className="w-full rounded border border-indigo-200 px-3 py-2 text-sm bg-white"
                  >
                    <option value="peptide">Peptide / Isopeptide Bond (C-N)</option>
                    <option value="disulfide">Disulfide Bridge (CYS SG-SG)</option>
                  </select>
                </div>
                
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleAutoGenerateRules}
                    disabled={!topContent}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    <Zap className="w-4 h-4" /> Add Rules Algorithmically
                  </button>
                  <button
                    onClick={() => {
                      setAtomsToDelete([]);
                      setChargeAdjustments([]);
                      setNewBonds([]);
                      setBondsToUpdate([]);
                      setBondsToDelete([]);
                    }}
                    className="bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Clear Rules
                  </button>
                </div>
              </div>
            </section>

            {/* Custom Rules Specification */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-blue-600" />
                Modification Rules
              </h2>
              
              <div className="space-y-6">
                
                {/* Atoms to Delete */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-slate-800">1. Atoms to Delete</label>
                    <button onClick={() => addToArray(setAtomsToDelete, { resId: '', atomName: '' })} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                      <Plus className="w-3 h-3" /> Add Atom
                    </button>
                  </div>
                  <div className="space-y-2">
                    {atomsToDelete.map((atom, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input type="text" placeholder="Res ID (e.g. 1)" value={atom.resId} onChange={(e) => updateArray(setAtomsToDelete, idx, 'resId', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        <input type="text" placeholder="Atom Name (e.g. OXT)" value={atom.atomName} onChange={(e) => updateArray(setAtomsToDelete, idx, 'atomName', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        <button onClick={() => removeFromArray(setAtomsToDelete, idx)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                    {atomsToDelete.length === 0 && <p className="text-xs text-slate-500 italic">No atoms to delete.</p>}
                  </div>
                </div>

                {/* Charge Adjustments */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-slate-800">2. Charge Adjustments</label>
                    <button onClick={() => addToArray(setChargeAdjustments, { resId: '', atomName: '', newCharge: '' })} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                      <Plus className="w-3 h-3" /> Add Charge
                    </button>
                  </div>
                  <div className="space-y-2">
                    {chargeAdjustments.map((charge, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input type="text" placeholder="Res ID" value={charge.resId} onChange={(e) => updateArray(setChargeAdjustments, idx, 'resId', e.target.value)} className="w-1/3 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        <input type="text" placeholder="Atom" value={charge.atomName} onChange={(e) => updateArray(setChargeAdjustments, idx, 'atomName', e.target.value)} className="w-1/3 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        <input type="text" placeholder="New Charge" value={charge.newCharge} onChange={(e) => updateArray(setChargeAdjustments, idx, 'newCharge', e.target.value)} className="w-1/3 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        <button onClick={() => removeFromArray(setChargeAdjustments, idx)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                    {chargeAdjustments.length === 0 && <p className="text-xs text-slate-500 italic">No charge adjustments.</p>}
                  </div>
                </div>

                {/* New Bonds */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-slate-800">3. New Bonds</label>
                    <button onClick={() => addToArray(setNewBonds, { resId1: '', atomName1: '', resId2: '', atomName2: '', params: '1' })} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                      <Plus className="w-3 h-3" /> Add Bond
                    </button>
                  </div>
                  <div className="space-y-2">
                    {newBonds.map((bond, idx) => (
                      <div key={idx} className="flex flex-col gap-2 bg-slate-50 p-3 rounded border border-slate-200 relative">
                        <button onClick={() => removeFromArray(setNewBonds, idx)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        <div className="flex gap-2 pr-6">
                          <input type="text" placeholder="Res 1" value={bond.resId1} onChange={(e) => updateArray(setNewBonds, idx, 'resId1', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          <input type="text" placeholder="Atom 1" value={bond.atomName1} onChange={(e) => updateArray(setNewBonds, idx, 'atomName1', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        </div>
                        <div className="flex gap-2 pr-6">
                          <input type="text" placeholder="Res 2" value={bond.resId2} onChange={(e) => updateArray(setNewBonds, idx, 'resId2', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          <input type="text" placeholder="Atom 2" value={bond.atomName2} onChange={(e) => updateArray(setNewBonds, idx, 'atomName2', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        </div>
                        <div className="pr-6">
                          <input type="text" placeholder="Params (e.g. 1 0.132 400000)" value={bond.params} onChange={(e) => updateArray(setNewBonds, idx, 'params', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        </div>
                      </div>
                    ))}
                    {newBonds.length === 0 && <p className="text-xs text-slate-500 italic">No new bonds.</p>}
                  </div>
                </div>

                {/* Modify Existing Bonds */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-slate-800">4. Modify Existing Bonds</label>
                    <button onClick={() => addToArray(setBondsToUpdate, { resId: '', atomName1: '', atomName2: '', newParams: '' })} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                      <Plus className="w-3 h-3" /> Add Modification
                    </button>
                  </div>
                  <div className="space-y-2">
                    {bondsToUpdate.map((bond, idx) => (
                      <div key={idx} className="flex flex-col gap-2 bg-slate-50 p-3 rounded border border-slate-200 relative">
                        <button onClick={() => removeFromArray(setBondsToUpdate, idx)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        <div className="flex gap-2 pr-6">
                          <input type="text" placeholder="Res ID" value={bond.resId} onChange={(e) => updateArray(setBondsToUpdate, idx, 'resId', e.target.value)} className="w-1/3 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          <input type="text" placeholder="Atom 1" value={bond.atomName1} onChange={(e) => updateArray(setBondsToUpdate, idx, 'atomName1', e.target.value)} className="w-1/3 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          <input type="text" placeholder="Atom 2" value={bond.atomName2} onChange={(e) => updateArray(setBondsToUpdate, idx, 'atomName2', e.target.value)} className="w-1/3 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        </div>
                        <div className="pr-6">
                          <input type="text" placeholder="New Params (e.g. 1 0.12300 502080.0)" value={bond.newParams} onChange={(e) => updateArray(setBondsToUpdate, idx, 'newParams', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        </div>
                      </div>
                    ))}
                    {bondsToUpdate.length === 0 && <p className="text-xs text-slate-500 italic">No existing bonds to modify.</p>}
                  </div>
                </div>

                {/* Delete Existing Bonds */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-slate-800">5. Delete Existing Bonds</label>
                    <button onClick={() => addToArray(setBondsToDelete, { resId1: '', atomName1: '', resId2: '', atomName2: '' })} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                      <Plus className="w-3 h-3" /> Add Deletion
                    </button>
                  </div>
                  <div className="space-y-2">
                    {bondsToDelete.map((bond, idx) => (
                      <div key={idx} className="flex flex-col gap-2 bg-slate-50 p-3 rounded border border-slate-200 relative">
                        <button onClick={() => removeFromArray(setBondsToDelete, idx)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        <div className="flex gap-2 pr-6">
                          <input type="text" placeholder="Res 1" value={bond.resId1} onChange={(e) => updateArray(setBondsToDelete, idx, 'resId1', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          <input type="text" placeholder="Atom 1" value={bond.atomName1} onChange={(e) => updateArray(setBondsToDelete, idx, 'atomName1', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        </div>
                        <div className="flex gap-2 pr-6">
                          <input type="text" placeholder="Res 2" value={bond.resId2} onChange={(e) => updateArray(setBondsToDelete, idx, 'resId2', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          <input type="text" placeholder="Atom 2" value={bond.atomName2} onChange={(e) => updateArray(setBondsToDelete, idx, 'atomName2', e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        </div>
                      </div>
                    ))}
                    {bondsToDelete.length === 0 && <p className="text-xs text-slate-500 italic">No existing bonds to delete.</p>}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <button
                    onClick={handleProcess}
                    disabled={isProcessing}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Process Files Locally
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => downloadFile(PYTHON_SCRIPT, 'grotop.py')}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors mt-3"
                  >
                    <Terminal className="w-4 h-4" />
                    Download grotop.py (CLI Script)
                  </button>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden sticky top-24 h-[calc(100vh-8rem)]">
              
              {!result && !isProcessing ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                  <FileText className="w-16 h-16 mb-4 opacity-20" />
                  <h3 className="text-lg font-medium text-slate-600 mb-2">Ready to Process</h3>
                  <p className="max-w-md text-sm">Upload your GRO and TOP files, specify your custom rules on the left, and click Process. Everything runs directly in your browser.</p>
                </div>
              ) : isProcessing ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8">
                  <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4" />
                  <p className="font-medium animate-pulse">Applying modifications...</p>
                </div>
              ) : result ? (
                <>
                  <div className="flex border-b border-slate-200 bg-slate-50/50">
                    <button 
                      className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'gro' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                      onClick={() => setActiveTab('gro')}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Modified GRO
                      </div>
                    </button>
                    <button 
                      className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'top' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                      onClick={() => setActiveTab('top')}
                    >
                      <div className="flex items-center gap-2">
                        <FileCode2 className="w-4 h-4" />
                        Modified TOP
                      </div>
                    </button>
                    {result.modifiedItp && (
                      <button 
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'itp' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                        onClick={() => setActiveTab('itp')}
                      >
                        <div className="flex items-center gap-2">
                          <FileCode2 className="w-4 h-4" />
                          Modified ITP
                        </div>
                      </button>
                    )}
                    {result.modifiedPosre && (
                      <button 
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'posre' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                        onClick={() => setActiveTab('posre')}
                      >
                        <div className="flex items-center gap-2">
                          <FileCode2 className="w-4 h-4" />
                          Modified posre.itp
                        </div>
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-auto p-0 relative bg-slate-50">
                    {activeTab === 'gro' && (
                      <div className="h-full flex flex-col">
                        <div className="bg-slate-100 border-b border-slate-200 p-2 flex justify-end gap-2 sticky top-0">
                          <button 
                            onClick={() => copyToClipboard(result.modifiedGro, 'gro')}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            {copiedGro ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedGro ? 'Copied!' : 'Copy'}
                          </button>
                          <button 
                            onClick={() => downloadFile(result.modifiedGro, `modified_${groName || 'system.gro'}`)}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download .gro
                          </button>
                        </div>
                        <pre className="p-4 text-xs font-mono text-slate-800 overflow-auto flex-1">
                          {result.modifiedGro}
                        </pre>
                      </div>
                    )}

                    {activeTab === 'top' && (
                      <div className="h-full flex flex-col">
                        <div className="bg-slate-100 border-b border-slate-200 p-2 flex justify-end gap-2 sticky top-0">
                          <button 
                            onClick={() => copyToClipboard(result.modifiedTop, 'top')}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            {copiedTop ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedTop ? 'Copied!' : 'Copy'}
                          </button>
                          <button 
                            onClick={() => downloadFile(result.modifiedTop, `modified_${topName || 'topol.top'}`)}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download .top
                          </button>
                        </div>
                        <pre className="p-4 text-xs font-mono text-slate-800 overflow-auto flex-1">
                          {result.modifiedTop}
                        </pre>
                      </div>
                    )}

                    {activeTab === 'itp' && result.modifiedItp && (
                      <div className="h-full flex flex-col">
                        <div className="bg-slate-100 border-b border-slate-200 p-2 flex justify-end gap-2 sticky top-0">
                          <button 
                            onClick={() => copyToClipboard(result.modifiedItp!, 'itp')}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            {copiedItp ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedItp ? 'Copied!' : 'Copy'}
                          </button>
                          <button 
                            onClick={() => downloadFile(result.modifiedItp!, `modified_${itpName || 'chain.itp'}`)}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download .itp
                          </button>
                        </div>
                        <pre className="p-4 text-xs font-mono text-slate-800 overflow-auto flex-1">
                          {result.modifiedItp}
                        </pre>
                      </div>
                    )}

                    {activeTab === 'posre' && result.modifiedPosre && (
                      <div className="h-full flex flex-col">
                        <div className="bg-slate-100 border-b border-slate-200 p-2 flex justify-end gap-2 sticky top-0">
                          <button 
                            onClick={() => copyToClipboard(result.modifiedPosre!, 'posre')}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            {copiedPosre ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedPosre ? 'Copied!' : 'Copy'}
                          </button>
                          <button 
                            onClick={() => downloadFile(result.modifiedPosre!, `modified_${posreName || 'posre.itp'}`)}
                            className="flex items-center gap-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded shadow-sm transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download posre.itp
                          </button>
                        </div>
                        <pre className="p-4 text-xs font-mono text-slate-800 overflow-auto flex-1">
                          {result.modifiedPosre}
                        </pre>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

function FileUploadBox({ 
  id, 
  label, 
  fileName, 
  accept, 
  onChange 
}: { 
  id: string; 
  label: string; 
  fileName: string; 
  accept: string; 
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void 
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <div className="relative">
        <input 
          type="file" 
          id={id}
          accept={accept}
          onChange={onChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div className={`flex items-center justify-between px-3 py-2 border rounded-md text-sm transition-colors ${fileName ? 'border-blue-300 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}>
          <span className={`truncate mr-2 ${fileName ? 'text-blue-700 font-medium' : 'text-slate-500'}`}>
            {fileName || `Choose ${accept} file...`}
          </span>
          <div className={`shrink-0 p-1 rounded ${fileName ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'}`}>
            <Upload className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

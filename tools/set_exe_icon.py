"""Remplace l'icône d'un .exe Windows (ressources RT_GROUP_ICON / RT_ICON), sans outil externe (API Windows par ctypes).
python set_exe_icon.py "<se7en studio.exe>" <icon.ico>
Toutes les icônes de groupe existantes (celle d'Electron) pointent ensuite vers les images de icon.ico."""
import ctypes
import struct
import sys
from ctypes import wintypes

exe, ico = sys.argv[1], sys.argv[2]
k32 = ctypes.WinDLL('kernel32', use_last_error=True)
RT_ICON, RT_GROUP_ICON = 3, 14
LOAD_LIBRARY_AS_DATAFILE = 0x2

k32.LoadLibraryExW.restype = wintypes.HMODULE
k32.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
k32.FreeLibrary.argtypes = [wintypes.HMODULE]
ENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
k32.EnumResourceNamesW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ENUMPROC, ctypes.c_void_p]
k32.BeginUpdateResourceW.restype = wintypes.HANDLE
k32.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
k32.UpdateResourceW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wintypes.WORD, ctypes.c_void_p, wintypes.DWORD]
k32.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]


def names(kind):
    """Noms (entiers ou chaînes) des ressources d'un type dans l'exe."""
    h = k32.LoadLibraryExW(exe, None, LOAD_LIBRARY_AS_DATAFILE)
    if not h:
        raise OSError(ctypes.get_last_error(), 'LoadLibraryEx')
    found = []

    def cb(hmod, typ, name, param):
        found.append(name if name < 0x10000 else ctypes.wstring_at(name))
        return True
    k32.EnumResourceNamesW(h, kind, ENUMPROC(cb), None)
    k32.FreeLibrary(h)
    return found


data = open(ico, 'rb').read()
_, typ, count = struct.unpack_from('<HHH', data, 0)
assert typ == 1, 'fichier .ico attendu'
images = []
for i in range(count):
    w, h, colors, res, planes, bpp, size, off = struct.unpack_from('<BBBBHHII', data, 6 + i * 16)
    images.append((w, h, colors, res, planes, bpp, data[off:off + size]))

groups = names(RT_GROUP_ICON) or [1]
icons = [n for n in names(RT_ICON) if isinstance(n, int)]
first = max(icons + [0]) + 1  # nouvelles images après celles d'Electron (aucune collision)

hup = k32.BeginUpdateResourceW(exe, False)
if not hup:
    raise OSError(ctypes.get_last_error(), 'BeginUpdateResource')
LANG = 1033
grp = struct.pack('<HHH', 0, 1, count)
for i, (w, h, colors, res, planes, bpp, img) in enumerate(images):
    rid = first + i
    buf = ctypes.create_string_buffer(img, len(img))
    if not k32.UpdateResourceW(hup, RT_ICON, rid, LANG, buf, len(img)):
        raise OSError(ctypes.get_last_error(), 'UpdateResource RT_ICON')
    grp += struct.pack('<BBBBHHIH', w, h, colors, res, planes, bpp, len(img), rid)
gbuf = ctypes.create_string_buffer(grp, len(grp))
for g in groups:
    name = g if isinstance(g, int) else ctypes.c_wchar_p(g)
    if not k32.UpdateResourceW(hup, RT_GROUP_ICON, name if isinstance(g, int) else ctypes.cast(name, ctypes.c_void_p), LANG, gbuf, len(grp)):
        raise OSError(ctypes.get_last_error(), 'UpdateResource RT_GROUP_ICON')
if not k32.EndUpdateResourceW(hup, False):
    raise OSError(ctypes.get_last_error(), 'EndUpdateResource')
print('icône remplacée :', len(images), 'images, groupes', groups)

from __future__ import annotations

import sys
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree


def validate(book_path: Path) -> None:
    with zipfile.ZipFile(book_path) as book:
        names = set(book.namelist())
        assert book.namelist()[0] == "mimetype", "mimetype must be the first entry"
        assert book.read("mimetype") == b"application/epub+zip"
        assert book.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        assert "META-INF/container.xml" in names
        assert "OEBPS/content.opf" in names
        for name in names:
            if Path(name).suffix.lower() not in {".xml", ".opf", ".xhtml", ".svg"}:
                continue
            try:
                root = ElementTree.fromstring(book.read(name))
            except ElementTree.ParseError as error:
                raise AssertionError(f"{name}: {error}") from error
            if name.endswith(".xhtml"):
                base = PurePosixPath(name).parent
                for element in root.iter():
                    ref = element.attrib.get("src")
                    if ref and not ref.startswith(("http:", "https:", "data:")):
                        target = str(base / ref)
                        assert target in names, f"{name}: missing resource {target}"
        opf = ElementTree.fromstring(book.read("OEBPS/content.opf"))
        namespace = {"opf": "http://www.idpf.org/2007/opf"}
        manifest = {item.attrib["id"]: item.attrib["href"] for item in opf.findall(".//opf:item", namespace)}
        spine = [item.attrib["idref"] for item in opf.findall(".//opf:itemref", namespace)]
        assert manifest and spine
        assert all(item_id in manifest for item_id in spine)
        assert any("nav" in item.attrib.get("properties", "") for item in opf.findall(".//opf:item", namespace))
    print(f"OK {book_path.name}: {len(names)} files")


for argument in sys.argv[1:]:
    validate(Path(argument))

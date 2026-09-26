# The desktop decides what every Device holds

Devices used to browse the desktop Library and pull whatever Videos they wanted, so all curation happened on the phone or TV. We moved it to the desktop, because the product is now about managing a Library on the desktop and sending it to Devices. The user switches Lists on for devices (or adds single Videos to the built-in Phone List), and the result is the On-device set. Each Device mirrors that set: it Downloads what is missing and deletes Offline copies that have left the set. Watch state flows back from Devices to the desktop so the desktop's unwatched view stays true.

## Considered Options

- **Device-driven pull (the old model)**: kept for Videos pulled on a Device itself. The mirror never deletes those.
- **One set per Device**: deferred. All Devices share one On-device set until someone needs different content on the TV and the phone.

## Consequences

The sync contract in `apps/shared` gains the On-device set and a way to report Watch state back, and both apps change together. A Device that has been away from the desktop for a while deletes Offline copies at its next connection, so the desktop UI must make leaving the set a visible act.

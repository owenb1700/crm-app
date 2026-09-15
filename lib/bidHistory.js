// When a won pipeline entry becomes a project, everything about the bid is
// frozen onto the project as `bidHistory`, so the project keeps its full
// history even if the pipeline entry is later edited or deleted. Private
// pieces (notes, files) go on the project's private doc instead, since
// the project doc itself is readable by the whole team.
export function buildBidSnapshot(pipeline) {
  return {
    pipelineId: pipeline.id,
    title: pipeline.title || null,
    stage: pipeline.stage || null,
    buildingSector: pipeline.buildingSector || null,
    bidDate: pipeline.bidDate || null,
    value: pipeline.value || null,
    workType: pipeline.workType || null,
    projectAddress: pipeline.projectAddress || null,
    engineeringFirm: {
      company: pipeline.company || null,
      contact: pipeline.contact || null,
      email: pipeline.email || null,
      phone: pipeline.phone || null
    },
    biddingCompanies: pipeline.biddingCompanies || [],
    equipment: pipeline.equipment || [],
    towerManufacturer: pipeline.towerManufacturer || null,
    modelNumber: pipeline.modelNumber || null,
    ownerId: pipeline.ownerId || null,
    salespersonId: pipeline.salespersonId || null,
    projectPointPersonId: pipeline.projectPointPersonId || null,
    outcome: pipeline.outcome || null,
    wonByContractor: pipeline.wonByContractor || null,
    resolvedAt: pipeline.resolvedAt || null,
    createdAt: pipeline.createdAt || null,
    snapshotAt: new Date().toISOString()
  };
}
